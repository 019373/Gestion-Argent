/* Gestion-Argent : contrôles, recherche, projets terminés, hors ligne */
(() => {
  'use strict';

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const arr = x => Array.isArray(x) ? x : [];
  const num = x => Number(x) || 0;
  const fmt = x => typeof money === 'function'
    ? money(x)
    : Number(x).toFixed(2) + ' CHF';
  const esc = x => String(x ?? '').replace(
    /[&<>"']/g,
    c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;',
      '"':'&quot;', "'":'&#39;'
    })[c]
  );
  const today = () => {
    const d = new Date();
    return [
      d.getFullYear(),
      String(d.getMonth()+1).padStart(2,'0'),
      String(d.getDate()).padStart(2,'0')
    ].join('-');
  };
  const uid = () => crypto.randomUUID?.() ||
    `ga-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const currentPage = () =>
    typeof page === 'string' ? page : '';
  const savedFor = p =>
    typeof reserved === 'function'
      ? num(reserved(p.id))
      : arr(data.reserves)
        .filter(r => r.projectId === p.id)
        .reduce((s,r) => s+num(r.amount),0);
  const main = () =>
    $('main') || $('#app') || $('.content');

  function panel(id, html, parent) {
    if (!parent || $('#'+id)) return null;
    const el = document.createElement('section');
    el.className = 'card ga-final-panel';
    el.id = id;
    el.innerHTML = html;
    parent.appendChild(el);
    return el;
  }

  // 1. Contrôle des données, sans correction automatique.
  function diagnose() {
    const issues = [];
    const txs = arr(data.transactions);
    const projects = arr(data.projects);
    const reserves = arr(data.reserves);
    const accounts = arr(data.accounts);

    const accountIds = new Set(
      accounts.map(a => String(a.id))
    );
    const projectIds = new Set(
      projects.map(p => String(p.id))
    );
    const transactionIds = new Map();

    for (const t of txs) {
      const id = String(t.id ?? '');

      if (id) {
        transactionIds.set(
          id,
          (transactionIds.get(id)||0)+1
        );
      }

      if (
        !Number.isFinite(Number(t.amount)) ||
        Number(t.amount)<0
      ) {
        issues.push(
          `Montant invalide dans une opération du ${
            t.date||'date inconnue'
          }.`
        );
      }

      const ids = t.kind==='transfer'
        ? [t.fromId,t.toId]
        : [t.accountId];

      if (ids.some(id =>
        id!=null &&
        id!=='' &&
        !accountIds.has(String(id))
      )) {
        issues.push(
          `Compte introuvable pour l'opération « ${
            t.description||t.date||'sans nom'
          } ».`
        );
      }
    }

    for (const count of transactionIds.values()) {
      if (count>1) {
        issues.push(
          `Identifiant d'opération en double (${count} occurrences).`
        );
      }
    }

    const bySource = new Map();

    for (const r of reserves) {
      if (!projectIds.has(String(r.projectId))) {
        issues.push(
          'Réservation associée à un projet introuvable.'
        );
      }

      if (!Number.isFinite(Number(r.amount))) {
        issues.push(
          'Montant de réservation invalide.'
        );
      }

      if (r.sourceTx) {
        const id = String(r.sourceTx);
        bySource.set(
          id,
          (bySource.get(id)||0)+num(r.amount)
        );
      }
    }

    for (const p of projects) {
      if (
        p.gaPurchaseTransactionId &&
        !txs.some(t =>
          String(t.id)===String(p.gaPurchaseTransactionId)
        )
      ) {
        issues.push(
          `Dépense d'achat introuvable pour « ${p.name} ».`
        );
      }

      if (savedFor(p)>num(p.target)+0.01) {
        issues.push(
          `Le projet « ${p.name} » dépasse son objectif.`
        );
      }
    }

    for (const [id,total] of bySource) {
      const tx = txs.find(t=>String(t.id)===id);

      if (!tx) {
        issues.push(
          'Réservation liée à un revenu introuvable.'
        );
      } else if (
        tx.kind==='income' &&
        total>num(tx.amount)+0.01
      ) {
        issues.push(
          `Réservations supérieures au revenu « ${
            tx.description||tx.date||id
          } ».`
        );
      }
    }

    if (
      typeof available==='function' &&
      available() < -0.01
    ) {
      issues.push(
        'Le montant disponible est négatif.'
      );
    }

    return [...new Set(issues)];
  }

  function diagnosticUI() {
    if (!['settings','home'].includes(currentPage())) {
      return;
    }

    const issues = diagnose();

    if (
      currentPage()==='home' &&
      !issues.length
    ) return;

    const box = panel(
      'ga-health',
      `<h2>Vérification des données</h2>
       <p id="ga-health-state"></p>
       <div id="ga-health-issues"></div>
       ${currentPage()==='settings'
         ? '<button type="button" class="btn" data-ga-check>Vérifier à nouveau</button>'
         : ''}`,
      main()
    );

    if (!box) return;

    $('#ga-health-state',box).textContent =
      issues.length
        ? `${issues.length} point(s) à vérifier. Aucun chiffre modifié.`
        : 'Aucune incohérence détectée.';

    const body = $('#ga-health-issues',box);

    for (const issue of issues.slice(0,15)) {
      const p = document.createElement('p');
      p.className = 'ga-final-error';
      p.textContent = '• '+issue;
      body.appendChild(p);
    }
  }

  // 2. Recherche dans l'historique.
  function searchUI() {
    if (currentPage()!=='history') return;

    const history = $('#historyList');

    if (!history || $('#ga-history-search')) {
      return;
    }

    const box = document.createElement('section');

    box.id = 'ga-history-search';
    box.className = 'card ga-final-panel';

    box.innerHTML = `
      <h2>Rechercher une opération</h2>
      <div class="ga-search-grid">
        <label>
          Nom, catégorie ou montant
          <input id="ga-find" type="search"
            placeholder="Ex. BAB, 25, transport">
        </label>
        <label>
          Du
          <input id="ga-from" type="date">
        </label>
        <label>
          Au
          <input id="ga-to" type="date">
        </label>
      </div>

      <button type="button" class="btn"
        data-ga-clear>
        Effacer la recherche
      </button>

      <p id="ga-find-count" class="caption"></p>
      <div id="ga-find-results"></div>
    `;

    history.parentElement.insertBefore(
      box,history
    );

    const find = $('#ga-find',box);
    const from = $('#ga-from',box);
    const to = $('#ga-to',box);

    function update() {
      const query = find.value.trim()
        .toLocaleLowerCase('fr');

      const active = Boolean(
        query || from.value || to.value
      );

      history.style.display =
        active ? 'none' : '';

      const results = $('#ga-find-results',box);
      results.replaceChildren();

      if (!active) {
        $('#ga-find-count',box).textContent='';
        return;
      }

      const accounts = new Map(
        arr(data.accounts).map(a=>[
          String(a.id),
          a.name||'Compte'
        ])
      );

      const matches = arr(data.transactions)
        .filter(t=>{
          const date=String(t.date||'').slice(0,10);

          if (from.value && date<from.value) {
            return false;
          }

          if (to.value && date>to.value) {
            return false;
          }

          const category =
            typeof CATS==='object'
              ? CATS[t.category]||t.category||''
              : t.category||'';

          const text = [
            t.date,
            t.description,
            t.kind,
            category,
            accounts.get(String(t.accountId)),
            num(t.amount),
            fmt(num(t.amount))
          ].join(' ').toLocaleLowerCase('fr');

          return text.includes(query);
        })
        .sort((a,b)=>
          String(b.date||'').localeCompare(
            String(a.date||'')
          )
        );

      $('#ga-find-count',box).textContent =
        `${matches.length} opération(s) trouvée(s).`;

      for (const t of matches.slice(0,250)) {
        const row=document.createElement('div');
        row.className='ga-final-result';

        const title=document.createElement('span');
        title.textContent =
          `${t.date||''} · ${
            t.description||t.kind||'Opération'
          }`;

        const amount=document.createElement('strong');

        amount.textContent =
          (t.kind==='expense'?'−':
           t.kind==='income'?'+':'')+
          fmt(num(t.amount));

        row.append(title,amount);
        results.appendChild(row);
      }

      if (matches.length>250) {
        const note=document.createElement('p');
        note.textContent =
          '250 premiers résultats affichés. Affine ta recherche.';
        results.appendChild(note);
      }
    }

    [find,from,to].forEach(el=>
      el.addEventListener('input',update)
    );

    $('[data-ga-clear]',box).addEventListener(
      'click',
      ()=>{
        find.value='';
        from.value='';
        to.value='';
        update();
      }
    );
  }

  // 3. Projets terminés et achats.
  function projectsUI() {
    if (currentPage()!=='projects') return;

    const host=main();
    if (!host) return;

    const projects=arr(data.projects);

    for (const p of projects.filter(x=>x.gaArchived)) {
      const button=$$('[data-project="add"]')
        .find(b=>String(b.dataset.id)===String(p.id));

      const card=button?.closest('.card');

      if (card) card.style.display='none';
    }

    const funded=projects.filter(p=>
      !p.gaArchived &&
      num(p.target)>0 &&
      savedFor(p)+0.009>=num(p.target)
    );

    if (funded.length) {
      panel(
        'ga-funded',
        `<h2>Projets entièrement financés</h2>`+
        funded.map(p=>`
          <div class="ga-final-result">
            <span>
              ${esc(p.name)}
              <small>${esc(fmt(savedFor(p)))}</small>
            </span>
            <button type="button" class="btn"
              data-ga-finish="${esc(p.id)}">
              Terminer
            </button>
          </div>
        `).join(''),
        host
      );
    }

    const archived=projects.filter(p=>p.gaArchived);

    if (archived.length) {
      panel(
        'ga-archived',
        `<h2>Projets terminés</h2>`+
        archived.map(p=>`
          <div class="ga-final-result">
            <span>
              ${esc(p.name)}
              <small>
                ${p.gaPurchased
                  ? p.gaPurchasePreviouslyRecorded
                    ? 'Achat déjà saisi'
                    : 'Achat enregistré : '+
                      esc(fmt(p.gaPurchaseAmount||0))
                  : 'Somme toujours réservée : '+
                    esc(fmt(savedFor(p)))}
              </small>
            </span>

            ${p.gaPurchased?'':`
              <span class="ga-final-buttons">
                <button type="button" class="btn"
                  data-ga-finish="${esc(p.id)}">
                  Enregistrer l'achat
                </button>
                <button type="button" class="btn"
                  data-ga-reopen="${esc(p.id)}">
                  Réouvrir
                </button>
              </span>
            `}
          </div>
        `).join(''),
        host
      );
    }
  }

  function archive(p) {
    if (!confirm(
      `Archiver « ${p.name} » sans enregistrer de dépense ?\n\n`+
      'Son argent restera réservé.'
    )) return;

    p.gaArchived=true;
    p.gaArchivedDate=today();
    p.gaPurchased=false;

    save();
  }

  function purchaseDialog(p) {
    const accounts=arr(data.accounts);

    const categories=typeof CATS==='object'
      ? Object.entries(CATS)
      : [];

    if (!accounts.length || !categories.length) {
      alert(
        'Ajoute d’abord un compte et une catégorie de dépense.'
      );
      return;
    }

    $('#ga-buy-dialog')?.remove();

    const dialog=document.createElement('dialog');

    dialog.id='ga-buy-dialog';
    dialog.className='ga-final-dialog';

    dialog.innerHTML=`
      <form method="dialog">
        <h2>Achat : ${esc(p.name)}</h2>
        <p>
          Cette action crée une dépense et libère
          les réservations du projet.
        </p>

        <label>
          Montant réellement payé (CHF)
          <input name="amount" type="number"
            min="0.01" step="0.01"
            value="${esc(num(p.target).toFixed(2))}"
            required>
        </label>

        <label>
          Compte débité
          <select name="account">
            ${accounts.map(a=>`
              <option value="${esc(a.id)}">
                ${esc(a.name||'Compte')}
              </option>
            `).join('')}
          </select>
        </label>

        <label>
          Catégorie
          <select name="category">
            ${categories.map(([id,name])=>`
              <option value="${esc(id)}">
                ${esc(name)}
              </option>
            `).join('')}
          </select>
        </label>

        <div class="ga-final-buttons">
          <button type="button" class="btn"
            data-ga-cancel>
            Annuler
          </button>
          <button type="submit" class="btn green-btn">
            Enregistrer l'achat
          </button>
        </div>
      </form>
    `;

    document.body.appendChild(dialog);

    dialog.addEventListener(
      'close',
      ()=>dialog.remove(),
      {once:true}
    );

    $('[data-ga-cancel]',dialog).addEventListener(
      'click',()=>dialog.close()
    );

    $('form',dialog).addEventListener('submit',event=>{
      event.preventDefault();

      const form=new FormData(event.target);

      const amount=Number(form.get('amount'));
      const accountId=String(form.get('account'));
      const category=String(form.get('category'));

      if (
        !Number.isFinite(amount) ||
        amount<=0 ||
        !accounts.some(a=>String(a.id)===accountId) ||
        !categories.some(([id])=>id===category)
      ) {
        alert('Vérifie les champs.');
        return;
      }

      const paid=Math.round(amount*100)/100;
      const released=savedFor(p);

      const selectedAccount=accounts.find(a=>
        String(a.id)===accountId
      );

      if (!confirm(
        `Confirmer le paiement de ${fmt(paid)} `+
        `sur ${selectedAccount?.name||'ce compte'} ?\n\n`+
        `${fmt(released)} de réservations seront libérés.`
      )) return;

      const snapshot=JSON.stringify(data);

      try {
        localStorage.setItem(
          'ga-before-last-purchase',
          snapshot
        );

        const purchaseId=uid();

        data.transactions.push({
          id:purchaseId,
          date:today(),
          kind:'expense',
          description:`Achat projet : ${p.name}`,
          amount:paid,
          category,
          accountId
        });

        data.reserves=data.reserves.filter(r=>
          String(r.projectId)!==String(p.id)
        );

        p.gaArchived=true;
        p.gaArchivedDate=today();
        p.gaPurchased=true;
        p.gaPurchaseAmount=paid;
        p.gaPurchaseTransactionId=purchaseId;

        dialog.close();
        save();

      } catch(error) {
        try {
          data=JSON.parse(snapshot);
          save();
        } catch(_) {}

        alert(
          'Impossible d’enregistrer cet achat.'
        );
      }
    });

    if (typeof dialog.showModal==='function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open','');
    }
  }

  function finish(id) {
    const p=arr(data.projects).find(x=>
      String(x.id)===String(id)
    );

    if (!p || p.gaPurchased) return;

    if (
      !p.gaArchived &&
      savedFor(p)+0.009<num(p.target)
    ) {
      alert(
        'Ce projet n’est pas encore entièrement financé.'
      );
      return;
    }

    $('#ga-finish-dialog')?.remove();

    const dialog=document.createElement('dialog');

    dialog.id='ga-finish-dialog';
    dialog.className='ga-final-dialog';

    dialog.innerHTML=`
      <h2>Terminer : ${esc(p.name)}</h2>
      <p>
        Choisis ce qui s'est réellement passé.
        N'enregistre pas deux fois le même achat.
      </p>

      <div class="ga-final-choice">
        <button type="button" class="btn green-btn"
          data-ga-choice="new">
          Enregistrer mon achat maintenant
        </button>

        <button type="button" class="btn"
          data-ga-choice="already">
          J'ai déjà enregistré la dépense
        </button>

        <button type="button" class="btn"
          data-ga-choice="archive">
          Archiver sans achat
        </button>

        <button type="button" class="btn"
          data-ga-choice="cancel">
          Annuler
        </button>
      </div>
    `;

    document.body.appendChild(dialog);

    dialog.addEventListener(
      'close',
      ()=>dialog.remove(),
      {once:true}
    );

    dialog.addEventListener('click',event=>{
      const action=event.target
        .closest('[data-ga-choice]')
        ?.dataset.gaChoice;

      if (!action) return;

      dialog.close();

      if (action==='new') {
        purchaseDialog(p);
      }

      if (action==='archive') {
        archive(p);
      }

      if (action==='already') {
        if (!confirm(
          `Confirmer que la dépense pour « ${p.name} » `+
          `est DÉJÀ enregistrée ?\n\n`+
          `${fmt(savedFor(p))} de réservations seront libérés. `+
          'Aucune nouvelle dépense ne sera créée.'
        )) return;

        const snapshot=JSON.stringify(data);

        try {
          localStorage.setItem(
            'ga-before-last-purchase',
            snapshot
          );

          data.reserves=data.reserves.filter(r=>
            String(r.projectId)!==String(p.id)
          );

          p.gaArchived=true;
          p.gaArchivedDate=today();
          p.gaPurchased=true;
          p.gaPurchaseAmount=0;
          p.gaPurchasePreviouslyRecorded=true;

          save();

        } catch(error) {
          try {
            data=JSON.parse(snapshot);
            save();
          } catch(_) {}

          alert(
            'Impossible de terminer ce projet.'
          );
        }
      }
    });

    if (typeof dialog.showModal==='function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open','');
    }
  }

  // Initialisation sans remplacer les fonctions financières.
  function decorate() {
    try {
      diagnosticUI();
      searchUI();
      projectsUI();
    } catch(error) {
      console.warn(
        'Gestion-Argent : module complémentaire',
        error
      );
    }
  }

  function start() {
    if (
      typeof render!=='function' ||
      typeof save!=='function' ||
      typeof data==='undefined'
    ) {
      console.warn(
        'Module complémentaire : application non reconnue.'
      );
      return;
    }

    const originalRender=render;

    render=function(...args) {
      const result=originalRender.apply(this,args);
      decorate();
      return result;
    };

    decorate();

    document.addEventListener('click',event=>{
      const button=event.target.closest('button');
      if (!button) return;

      if (button.hasAttribute('data-ga-check')) {
        $('#ga-health')?.remove();
        diagnosticUI();
      }

      if (button.hasAttribute('data-ga-finish')) {
        event.preventDefault();
        finish(button.dataset.gaFinish);
      }

      if (button.hasAttribute('data-ga-reopen')) {
        event.preventDefault();

        const p=arr(data.projects).find(p=>
          String(p.id)===String(
            button.dataset.gaReopen
          )
        );

        if (
          p &&
          !p.gaPurchased &&
          confirm(
            `Réouvrir « ${p.name} » ? `+
            'L’argent reste réservé.'
          )
        ) {
          p.gaArchived=false;
          save();
        }
      }
    });

    // 4. Mode hors connexion.
    if (
      'serviceWorker' in navigator &&
      (
        location.protocol==='https:' ||
        location.hostname==='localhost'
      )
    ) {
      const register=()=>navigator.serviceWorker
        .register('./gestion-offline-sw.js')
        .catch(error=>console.warn(
          'Mode hors connexion non activé',
          error
        ));

      if (document.readyState==='complete') {
        register();
      } else {
        window.addEventListener(
          'load',register,{once:true}
        );
      }
    }
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
