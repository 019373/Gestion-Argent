/* Gestion-Argent : répartition des revenus irréguliers */
(() => {
  'use strict';

  const q = (s,root=document) => root.querySelector(s);
  const all = (s,root=document) =>
    [...root.querySelectorAll(s)];

  const n = x =>
    Number(String(x ?? '').replace(',','.'));

  const cents = x =>
    Math.round((x + Number.EPSILON)*100);

  const dec = x => Math.round(x)/100;

  const fmt = x => money(x);

  const safe = s => String(s??'').replace(
    /[&<>"']/g,
    c => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;'
    })[c]
  );

  const uuid = () =>
    crypto.randomUUID?.() ||
    `${Date.now()}-${Math.random()}`;

  // Formulaire de création des projets.
  function setupProjectForm() {
    if (page !== 'projects') return;

    const form = q('#projectForm');

    if (!form || form.dataset.gaSimple === '1') {
      return;
    }

    form.dataset.gaSimple = '1';

    // Le pourcentage et le montant fixe ne sont
    // plus demandés lors de la création.
    for (const name of ['ruleType','ruleValue']) {
      const control = form.elements.namedItem(name);
      control?.closest('.field')?.remove();
    }

    const selected = data.projects.find(
      p => p.id === editProject
    );

    if (!selected) {
      const field = document.createElement('div');

      field.className = 'field';

      field.innerHTML = `
        <label for="ga-initial-money">
          Déjà économisé (CHF, facultatif)
        </label>
        <input
          id="ga-initial-money"
          name="gaInitial"
          type="number"
          min="0"
          step="0.01"
          value="0">
      `;

      const deadline = form.elements
        .namedItem('deadline')
        ?.closest('.field');

      if (deadline) {
        deadline.insertAdjacentElement(
          'beforebegin',field
        );
      } else {
        q('.formgrid',form)?.appendChild(field);
      }
    }

    // Adapter uniquement la description des projets.
    const notice = all('.notice').find(x =>
      x.textContent.includes('pourcentage') &&
      x.textContent.includes('revenu')
    );

    if (notice) {
      notice.textContent =
        'Crée un projet. Quand tu reçois de l’argent, ' +
        'tu choisis combien économiser et comment le répartir.';
    }

    // Les anciennes étiquettes "% / revenu"
    // ne sont plus pertinentes.
    for (const p of data.projects) {
      const button = all(
        '[data-project="add"]'
      ).find(b => b.dataset.id === p.id);

      button?.closest('.card')
        ?.querySelector('.tag')
        ?.remove();
    }
  }

  // Enregistrer un projet sans règle automatique.
  function saveProject(event) {
    if (event.target?.id !== 'projectForm') {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const f = new FormData(event.target);

    const name = String(
      f.get('name') || ''
    ).trim();

    const target = n(f.get('target'));
    const initial = n(f.get('gaInitial') || 0);

    if (
      !name ||
      !Number.isFinite(target) ||
      target <= 0 ||
      !Number.isFinite(initial) ||
      initial < 0
    ) {
      alert('Vérifie le nom et les montants.');
      return;
    }

    if (
      !editProject &&
      initial > target + 0.001
    ) {
      alert(
        'Le montant déjà économisé dépasse le prix du projet.'
      );
      return;
    }

    if (
      !editProject &&
      initial > Math.max(0,available()) + 0.001
    ) {
      alert(
        'Tu ne peux pas réserver plus que ton argent disponible.'
      );
      return;
    }

    const previous = data.projects.find(
      p => p.id === editProject
    );

    const project = {
      ...(previous || {}),
      id: previous?.id || uuid(),
      name,
      target: dec(cents(target)),
      deadline: String(f.get('deadline') || ''),
      priority: String(f.get('priority') || 'normal'),
      ruleType: 'manual',
      ruleValue: 0
    };

    if (previous) {
      data.projects = data.projects.map(p =>
        p.id === previous.id ? project : p
      );
    } else {
      data.projects.push(project);

      if (initial > 0) {
        data.reserves.push({
          id: uuid(),
          projectId: project.id,
          amount: dec(cents(initial)),
          date: now()
        });
      }
    }

    editProject = null;
    save();
  }

  // Nouvelle fenêtre de répartition d'un revenu.
  function distributeIncome(txId) {
    const tx = data.transactions.find(t =>
      t.id === txId &&
      t.kind === 'income'
    );

    if (!tx) return;

    const projects = data.projects.filter(p =>
      p.target - reserved(p.id) > 0.001
    );

    if (!projects.length) {
      alert(
        'Crée d’abord un projet pour répartir ce revenu.'
      );
      return;
    }

    const committed = dec(
      data.reserves
        .filter(r => r.sourceTx === tx.id)
        .reduce(
          (s,r) => s + cents(Number(r.amount)||0),
          0
        )
    );

    const maxIncome = Math.max(
      0,
      dec(cents(tx.amount)-cents(committed))
    );

    const freeMoney = Math.max(
      0,
      available()
    );

    const cap = Math.min(
      maxIncome,
      freeMoney
    );

    if (cap < 0.01) {
      alert(
        'Il n’y a pas de montant disponible à réserver.'
      );
      return;
    }

    q('#ga-allocation-dialog')?.remove();

    const modal = document.createElement('dialog');

    modal.id = 'ga-allocation-dialog';
    modal.className = 'ga-allocation-dialog';

    const rows = projects.map(p => `
      <label class="ga-allocation-row">
        <span>
          ${safe(p.name)}
          <small>
            Encore ${fmt(
              Math.max(0,p.target-reserved(p.id))
            )}
          </small>
        </span>

        <input
          type="number"
          inputmode="decimal"
          min="0"
          step="0.01"
          data-ga-project="${safe(p.id)}"
          value="0"
          aria-label="Montant pour ${safe(p.name)}">
      </label>
    `).join('');

    modal.innerHTML = `
      <form method="dialog" class="ga-allocation-content">
        <div class="ga-allocation-top">
          <h2>Répartir ce revenu</h2>
          <button type="button"
            data-ga-close
            aria-label="Fermer">×</button>
        </div>

        <p>
          Revenu reçu :
          <strong>${fmt(tx.amount)}</strong>
        </p>

        <div class="ga-allocation-grid">
          <label>
            Comment économiser ?
            <select id="ga-saving-method">
              <option value="percent">
                Pourcentage du revenu
              </option>
              <option value="fixed">
                Montant fixe
              </option>
            </select>
          </label>

          <label>
            Valeur
            <span id="ga-saving-unit">(%)</span>
            <input
              id="ga-saving-value"
              type="number"
              inputmode="decimal"
              min="0"
              max="100"
              step="0.01"
              value="20">
          </label>
        </div>

        <div class="ga-saving-numbers">
          <div>
            Montant choisi
            <strong id="ga-saving-target"></strong>
          </div>

          <div>
            Maximum possible
            <strong>${fmt(cap)}</strong>
          </div>

          <div>
            Non attribué, reste disponible
            <strong id="ga-saving-left"></strong>
          </div>
        </div>

        <h3>Répartition entre tes projets</h3>

        <div class="ga-allocation-projects">
          ${rows}
        </div>

        <p id="ga-saving-message" role="status"></p>

        <div class="ga-allocation-actions">
          <button type="button"
            class="btn"
            data-ga-close>
            Tout garder disponible
          </button>

          <button type="button"
            class="btn green-btn"
            id="ga-apply-savings">
            Confirmer la répartition
          </button>
        </div>
      </form>
    `;

    document.body.appendChild(modal);

    modal.addEventListener(
      'close',
      () => modal.remove(),
      {once:true}
    );

    const inputs = all(
      '[data-ga-project]',
      modal
    );

    const method = q(
      '#ga-saving-method',
      modal
    );

    const value = q(
      '#ga-saving-value',
      modal
    );

    const confirmButton = q(
      '#ga-apply-savings',
      modal
    );

    function amountCents() {
      const v = n(value.value);

      if (
        !Number.isFinite(v) ||
        v < 0
      ) return null;

      if (method.value === 'percent') {
        return v <= 100
          ? Math.max(0,cents(tx.amount*v/100))
          : null;
      }

      return Math.max(0,cents(v));
    }

    function validate() {
      const wanted = amountCents();

      const values = inputs.map(input =>
        n(input.value)
      );

      const sum = values.reduce(
        (s,x) => s+cents(x),
        0
      );

      const invalid = values.some((x,i) =>
        !Number.isFinite(x) ||
        x < 0 ||
        x > projects[i].target -
          reserved(projects[i].id) + 0.001
      );

      const limit = wanted === null
        ? 0
        : Math.min(wanted,cents(cap));

      const over =
        Number.isNaN(sum) ||
        sum > limit;

      q('#ga-saving-target',modal).textContent =
        wanted===null
          ? 'Valeur invalide'
          : fmt(dec(wanted));

      q('#ga-saving-left',modal).textContent =
        fmt(Math.max(0,dec(cents(tx.amount)-sum)));

      let message = '';

      if (wanted===null) {
        message = 'Valeur invalide.';
      } else if (wanted>cents(cap)) {
        message =
          'Le montant choisi dépasse ton argent disponible.';
      } else if (invalid || over) {
        message =
          'Vérifie les montants attribués aux projets.';
      } else if (sum<limit) {
        message =
          'Tu peux répartir davantage ou laisser le reste disponible.';
      } else {
        message =
          'Répartition prête à être confirmée.';
      }

      q('#ga-saving-message',modal).textContent =
        message;

      confirmButton.disabled =
        wanted===null ||
        invalid ||
        over ||
        sum<=0;
    }

    function suggest() {
      const wanted = amountCents();

      const budget = Math.max(
        0,
        Math.min(wanted||0,cents(cap))
      );

      const room = projects.map(p =>
        Math.max(
          0,
          cents(p.target-reserved(p.id))
        )
      );

      const weights = projects.map(p =>
        p.priority==='high'
          ? 3
          : p.priority==='low'
            ? 1
            : 2
      );

      const assigned = room.map(()=>0);

      let remain = budget;

      // Répartition indicative selon les priorités.
      while (remain>0) {
        const active = room
          .map((r,i)=>
            r>assigned[i] ? i : -1
          )
          .filter(i=>i>=0);

        if (!active.length) break;

        const weight = active.reduce(
          (s,i)=>s+weights[i],
          0
        );

        let granted=0;

        for (const i of active) {
          const give = Math.min(
            room[i]-assigned[i],
            Math.floor(
              remain*weights[i]/weight
            )
          );

          assigned[i]+=give;
          granted+=give;
        }

        if (granted===0) {
          assigned[active[0]]++;
          granted=1;
        }

        remain-=granted;
      }

      inputs.forEach((input,i)=>{
        input.value=dec(assigned[i]).toFixed(2);
      });

      validate();
    }

    method.addEventListener('change',()=>{
      const percentage =
        method.value==='percent';

      q('#ga-saving-unit',modal).textContent =
        percentage ? '(%)' : '(CHF)';

      value.max = percentage
        ? '100'
        : String(tx.amount);

      value.value = percentage
        ? '20'
        : String(dec(cents(tx.amount*0.2)));

      suggest();
    });

    value.addEventListener(
      'input',
      suggest
    );

    inputs.forEach(input =>
      input.addEventListener(
        'input',
        validate
      )
    );

    all('[data-ga-close]',modal).forEach(button =>
      button.addEventListener(
        'click',
        ()=>modal.close()
      )
    );

    confirmButton.addEventListener('click',()=>{
      validate();

      if (confirmButton.disabled) return;

      const amounts = inputs
        .map((input,i)=>({
          project: projects[i],
          amount: dec(cents(n(input.value)))
        }))
        .filter(x=>x.amount>0);

      for (const item of amounts) {
        data.reserves.push({
          id: uuid(),
          projectId: item.project.id,
          amount: item.amount,
          date: tx.date,
          sourceTx: tx.id
        });
      }

      modal.close();
      save();
    });

    suggest();

    if (typeof modal.showModal==='function') {
      modal.showModal();
    } else {
      modal.setAttribute('open','');
    }
  }

  function start() {
    if (
      typeof render!=='function' ||
      typeof save!=='function' ||
      typeof projects!=='function' ||
      typeof allocate!=='function' ||
      typeof data==='undefined'
    ) {
      console.warn(
        'Version Gestion-Argent non reconnue.'
      );
      return;
    }

    const oldRender = render;

    render = function(...args) {
      const result = oldRender.apply(this,args);
      setupProjectForm();
      return result;
    };

    // Les estimations ne dépendent plus
    // d'un salaire mensuel supposé.
    forecast = function(p) {
      if (
        p.target-reserved(p.id)<=0
      ) return 'Objectif atteint.';

      return 'Tu choisis combien économiser lorsque tu reçois un revenu.';
    };

    // Remplacer la proposition automatique
    // par une répartition libre.
    allocate = distributeIncome;

    setupProjectForm();

    document.addEventListener(
      'submit',
      saveProject,
      true
    );
  }

  if (document.readyState==='loading') {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      {once:true}
    );
  } else {
    start();
  }
})();
