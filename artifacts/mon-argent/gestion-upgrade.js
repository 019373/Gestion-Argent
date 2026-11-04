/* Gestion-Argent : améliorations supplémentaires */
(() => {
  'use strict';

  const $ = (s, root=document) => root.querySelector(s);

  const euros = x => typeof money === 'function'
    ? money(x)
    : Number(x).toFixed(2) + ' CHF';

  const today = () => {
    const d = new Date();
    return [
      d.getFullYear(),
      String(d.getMonth()+1).padStart(2,'0'),
      String(d.getDate()).padStart(2,'0')
    ].join('-');
  };

  const dateOf = iso => new Date(
    Number(iso.slice(0,4)),
    Number(iso.slice(5,7))-1,
    Number(iso.slice(8,10)||1),
    12
  );

  const safe = x => String(x??'').replace(
    /[&<>"']/g,
    c => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;'
    })[c]
  );

  function element(tag, cls, html) {
    const el = document.createElement(tag);
    el.className = cls;
    el.innerHTML = html;
    return el;
  }

  // 1. Sauvegardes
  function exportData() {
    const content = {
      application: 'Gestion-Argent',
      version: 4,
      exportedAt: new Date().toISOString(),
      data
    };

    const blob = new Blob(
      [JSON.stringify(content,null,2)],
      {type:'application/json'}
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `Gestion-Argent-${today()}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url),2000);

    localStorage.setItem(
      'ga-last-export',
      new Date().toISOString()
    );

    updateBackupDate();
  }

  function updateBackupDate() {
    const el = $('#ga-backup-date');
    if(!el) return;

    const last = localStorage.getItem('ga-last-export');

    el.textContent = last
      ? 'Dernière exportation : ' +
        new Date(last).toLocaleString('fr-CH')
      : 'Aucune sauvegarde exportée récemment.';
  }

  async function importData(file) {
    if(!file) return;

    try {
      const raw = JSON.parse(await file.text());

      const source = raw?.application==='Gestion-Argent'
        ? raw.data
        : (raw?.data||raw);

      if(
        !source ||
        !Array.isArray(source.accounts) ||
        !Array.isArray(source.transactions) ||
        (source.projects!=null &&
          !Array.isArray(source.projects)) ||
        (source.reserves!=null &&
          !Array.isArray(source.reserves)) ||
        (source.recurring!=null &&
          !Array.isArray(source.recurring))
      ) {
        throw new Error('Format incorrect');
      }

      const dateText = raw.exportedAt || raw.date;
      const d = dateText ? new Date(dateText) : null;
      const label = d && !Number.isNaN(d.getTime())
        ? d.toLocaleString('fr-CH')
        : 'Non indiquée';

      const text =
        'Restaurer cette sauvegarde ?\n\n' +
        'Date : ' + label + '\n' +
        'Comptes : ' + source.accounts.length + '\n' +
        'Opérations : ' + source.transactions.length + '\n' +
        'Projets : ' + (source.projects||[]).length + '\n' +
        'Récurrences : ' + (source.recurring||[]).length +
        '\n\nLes données actuelles seront remplacées.';

      if(!confirm(text)) return;

      const restored = migrate(source);

      localStorage.setItem(
        STORE,
        JSON.stringify(restored)
      );

      data = restored;
      render();

      alert('Sauvegarde restaurée.');

    } catch(err) {
      alert(
        'Impossible de restaurer le fichier : ' +
        err.message
      );
    }
  }

  function backupPanel() {
    if(page!=='settings') return;

    const existing = $('#exportBackup') ||
      $('#importBackup');

    if(existing) {
      const card = existing.closest('.card');

      if(card && !$('#ga-backup-date',card)) {
        card.appendChild(element(
          'p','caption',
          '<span id="ga-backup-date"></span>'
        ));
      }
    } else {
      const main = $('main');

      if(main && !$('#ga-backup-panel')) {
        const panel = element('section','card',`
          <h2>Sauvegardes</h2>
          <p>Conserve une copie de tes données.</p>

          <div class="buttons">
            <button class="btn green-btn"
              type="button" id="ga-export">
              Exporter mes données
            </button>
          </div>

          <div class="field" style="margin-top:16px">
            <label for="ga-import">
              Restaurer mes données
            </label>

            <input id="ga-import"
              type="file"
              accept=".json,application/json">
          </div>

          <p class="caption">
            Une restauration remplace les données actuelles.
          </p>

          <p class="caption" id="ga-backup-date"></p>
        `);

        panel.id = 'ga-backup-panel';
        main.appendChild(panel);
      }
    }

    updateBackupDate();
  }

  // 2. Annuler une suppression
  let deleted = null;
  let undoTimer = null;

  function showUndo() {
    $('#ga-undo')?.remove();

    const bar = element('div','ga-undo',`
      <span>Opération supprimée</span>
      <button class="btn green-btn"
        type="button"
        id="ga-undo-button">
        Annuler
      </button>
    `);

    bar.id = 'ga-undo';
    document.body.appendChild(bar);

    clearTimeout(undoTimer);

    undoTimer = setTimeout(() => {
      deleted = null;
      bar.remove();
    },10000);
  }

  function undoDelete() {
    if(!deleted) return;

    const previous = deleted;
    deleted = null;

    clearTimeout(undoTimer);
    $('#ga-undo')?.remove();

    if(data.transactions.some(t =>
      t.id===previous.transaction.id
    )) return;

    data.transactions.push(previous.transaction);

    for(const r of previous.reserves) {
      if(!data.reserves.some(x=>x.id===r.id)) {
        data.reserves.push(r);
      }
    }

    save();
  }

  // 3. Affichage fiable du mois sur iPhone
  function monthDisplay() {
    const input = $('#month');

    if(!input || input.closest('.ga-month')) return;

    const wrapper = document.createElement('span');
    wrapper.className = 'ga-month';

    const label = document.createElement('span');
    label.className = 'ga-month-label';
    label.setAttribute('aria-hidden','true');

    function update() {
      if(/^\d{4}-\d{2}$/.test(input.value)) {
        label.textContent = new Intl.DateTimeFormat(
          'fr-CH',
          {month:'long',year:'numeric'}
        ).format(dateOf(input.value+'-01'));
      } else {
        label.textContent = 'Choisir un mois';
      }
    }

    input.parentNode.insertBefore(wrapper,input);

    wrapper.appendChild(label);
    wrapper.appendChild(input);

    input.classList.add('ga-month-native');
    input.addEventListener('change',update);

    update();
  }

  // 4. Alertes de budget
  function budgetAlerts() {
    if(!['home','budgets'].includes(page)) return;

    const alerts = [];

    for(const [c,name] of Object.entries(CATS)) {
      const limit = Number(data.budgets?.[c]||0);
      const spent = categorySum(c);

      if(limit<=0 || spent<limit*0.8) continue;

      const exceeded = spent>=limit;

      const message = spent>limit
        ? 'Dépassement : '+euros(spent-limit)
        : exceeded
          ? 'Limite atteinte'
          : Math.floor(spent/limit*100)+' % utilisés';

      alerts.push(`
        <div class="ga-alert-row ${
          exceeded?'ga-red':'ga-green'
        }">
          <span>${safe(name)}</span>
          <strong>${safe(message)}</strong>
        </div>
      `);
    }

    if(!alerts.length || $('#ga-budget-alerts')) return;

    const top = $('.toprow');
    if(!top) return;

    const box = element('section','card',`
      <h2>Suivi des budgets</h2>
      ${alerts.join('')}
    `);

    box.id = 'ga-budget-alerts';
    top.insertAdjacentElement('afterend',box);
  }

  // 5. Estimation des projets avec une date
  function projectProgress() {
    if(page!=='projects') return;

    for(const p of data.projects) {
      if(!p.deadline) continue;

      const button = [
        ...document.querySelectorAll('[data-project="add"]')
      ].find(b=>b.dataset.id===p.id);

      const card = button?.closest('.card');

      if(!card || $('.ga-project-progress',card)) {
        continue;
      }

      const deadline = dateOf(p.deadline);
      const current = dateOf(today());

      const days = (deadline-current)/86400000;
      const remaining = Math.max(
        0,
        Number(p.target)-reserved(p.id)
      );

      let message = '';

      if(remaining<=0) {
        message = 'Objectif atteint.';
      } else if(days<0) {
        message = 'Date souhaitée dépassée.';
      } else if(days<1) {
        message = 'Il reste '+euros(remaining)+
          ' à économiser aujourd’hui.';
      } else {
        const months = days/30.4375;
        const required = Math.ceil(
          remaining/months*100
        )/100;

        message = 'À économiser : environ '+
          euros(required)+' par mois.';

        const deposits = data.reserves
          .filter(x=>
            x.projectId===p.id &&
            x.date &&
            Number(x.amount)>0
          )
          .sort((a,b)=>a.date.localeCompare(b.date));

        if(deposits.length>=2) {
          const first = dateOf(deposits[0].date);

          const elapsed = (current-first)/86400000;

          if(elapsed>=7) {
            const net = data.reserves
              .filter(x=>
                x.projectId===p.id &&
                x.date>=deposits[0].date
              )
              .reduce((s,x)=>
                s+Number(x.amount||0),0
              );

            const pace = Math.max(0,net)/
              (elapsed/30.4375);

            message += pace>=required
              ? ' Ton rythme récent semble suffisant.'
              : ' Ton rythme récent est inférieur à cet objectif.';
          }
        }
      }

      const info = element(
        'p','ga-project-progress',safe(message)
      );

      const buttons = $('.buttons',card);

      if(buttons) {
        card.insertBefore(info,buttons);
      } else {
        card.appendChild(info);
      }
    }
  }

  // 6. Comparaison des mois
  function comparison() {
    if(page!=='home' || $('#ga-comparison')) return;

    if(!/^\d{4}-\d{2}$/.test(month)) return;

    const y = Number(month.slice(0,4));
    const m = Number(month.slice(5,7));

    const previousDate = new Date(y,m-2,1);

    const previous = [
      previousDate.getFullYear(),
      String(previousDate.getMonth()+1).padStart(2,'0')
    ].join('-');

    const current = sum('expense',month);
    const old = sum('expense',previous);
    const difference = current-old;

    const text = old===0
      ? 'Aucune dépense le mois précédent'
      : difference===0
        ? 'Dépenses identiques au mois précédent'
        : euros(Math.abs(difference))+
          (difference>0?' de plus':' de moins')+
          ' que le mois précédent';

    const cards = $('.cards');
    if(!cards) return;

    const box = element('div','ga-comparison',`
      <span>Comparaison mensuelle</span>
      <strong class="${
        difference>0?'ga-red':'ga-green'
      }">${safe(text)}</strong>
    `);

    box.id = 'ga-comparison';
    cards.insertAdjacentElement('afterend',box);
  }

  // 7. Échéances récurrentes à venir
  function nextOccurrence(rule) {
    if(rule.paused || !rule.startDate) return null;

    const start = dateOf(rule.startDate);
    const current = dateOf(today());

    if(Number.isNaN(start.getTime())) return null;

    for(let i=0;i<1000;i++) {
      let d;

      if(rule.frequency==='weekly') {
        d = new Date(
          start.getFullYear(),
          start.getMonth(),
          start.getDate()+7*i,
          12
        );
      } else if(rule.frequency==='yearly') {
        const y = start.getFullYear()+i;
        const m = start.getMonth();

        d = new Date(
          y,m,
          Math.min(
            start.getDate(),
            new Date(y,m+1,0).getDate()
          ),
          12
        );
      } else {
        const y = start.getFullYear();
        const m = start.getMonth()+i;

        d = new Date(
          y,m,
          Math.min(
            start.getDate(),
            new Date(y,m+1,0).getDate()
          ),
          12
        );
      }

      if(d<current) continue;
      if(d-current>31*86400000) break;

      const date = [
        d.getFullYear(),
        String(d.getMonth()+1).padStart(2,'0'),
        String(d.getDate()).padStart(2,'0')
      ].join('-');

      if(!data.transactions.some(t=>
        t.recurringId===rule.id &&
        t.occurrenceDate===date
      )) {
        return date;
      }
    }

    return null;
  }

  function upcoming() {
    if(
      page!=='home' ||
      !data.recurring?.length ||
      $('#ga-upcoming')
    ) return;

    const list = data.recurring
      .map(r=>({...r,next:nextOccurrence(r)}))
      .filter(r=>r.next)
      .sort((a,b)=>a.next.localeCompare(b.next))
      .slice(0,5);

    if(!list.length) return;

    const rows = list.map(r=>`
      <div class="ga-alert-row">
        <span>
          ${safe(r.next)} · ${safe(r.description)}
        </span>
        <strong class="${
          r.kind==='income'?'ga-green':'ga-red'
        }">
          ${r.kind==='income'?'+':'−'}
          ${euros(r.amount)}
        </strong>
      </div>
    `).join('');

    const main = $('main');
    if(!main) return;

    const box = element('section','card',`
      <h2>Échéances à venir (31 jours)</h2>
      ${rows}
      <p class="caption">
        Prévisions uniquement.
        Aucun paiement enregistré automatiquement.
      </p>
    `);

    box.id = 'ga-upcoming';
    main.appendChild(box);
  }

  // 8. Export CSV de l'historique
  function csvButton() {
    if(page!=='history' || $('#ga-csv')) return;

    const history = $('#historyList');
    if(!history) return;

    const heading = history.parentElement
      ?.querySelector('h2');

    if(!heading) return;

    const button = element(
      'button','btn small','Exporter CSV'
    );

    button.id = 'ga-csv';
    button.type = 'button';

    heading.insertAdjacentElement('afterend',button);
  }

  function downloadCsv() {
    const rows = [[
      'Date','Type','Description',
      'Catégorie','Compte','Montant CHF'
    ]];

    const transactions =
      typeof filteredHistory==='function'
        ? filteredHistory()
        : [...data.transactions];

    for(const t of transactions) {
      const account = t.kind==='transfer'
        ? accountName(t.fromId)+' → '+accountName(t.toId)
        : accountName(t.accountId);

      rows.push([
        t.date,
        t.kind,
        t.description||'',
        CATS[t.category]||'',
        account,
        t.kind==='expense'
          ? -t.amount
          : t.kind==='transfer'
            ? ''
            : t.amount
      ]);
    }

    const cell = x => '"'+String(x??'')
      .replace(/"/g,'""')+'"';

    const csv = '\ufeff'+rows.map(row=>
      row.map(cell).join(';')
    ).join('\r\n');

    const blob = new Blob(
      [csv],
      {type:'text/csv;charset=utf-8'}
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download =
      'Gestion-Argent-operations-'+today()+'.csv';

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }

  function decorate() {
    monthDisplay();
    backupPanel();
    budgetAlerts();
    comparison();
    projectProgress();
    upcoming();
    csvButton();
  }

  function start() {
    if(
      typeof render!=='function' ||
      typeof migrate!=='function' ||
      typeof save!=='function' ||
      typeof data==='undefined'
    ) {
      console.warn(
        'Version de Gestion-Argent non reconnue.'
      );
      return;
    }

    const originalRender = render;

    render = function(...args) {
      const result = originalRender.apply(this,args);
      decorate();
      return result;
    };

    decorate();

    document.addEventListener('click',event=>{
      const button = event.target.closest('button');
      if(!button) return;

      // Suppression réversible.
      if(button.dataset.delTx) {
        event.preventDefault();
        event.stopImmediatePropagation();

        const tx = data.transactions.find(t=>
          t.id===button.dataset.delTx
        );

        if(!tx || !confirm('Supprimer cette opération ?')) {
          return;
        }

        deleted = {
          transaction:JSON.parse(JSON.stringify(tx)),
          reserves:JSON.parse(JSON.stringify(
            data.reserves.filter(r=>
              r.sourceTx===tx.id
            )
          ))
        };

        data.transactions=data.transactions.filter(t=>
          t.id!==tx.id
        );

        data.reserves=data.reserves.filter(r=>
          r.sourceTx!==tx.id
        );

        save();
        showUndo();
        return;
      }

      if(button.id==='ga-undo-button') {
        event.preventDefault();
        event.stopImmediatePropagation();
        undoDelete();
        return;
      }

      if(
        button.id==='ga-export' ||
        button.id==='exportBackup'
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        exportData();
        return;
      }

      if(button.id==='ga-csv') {
        event.preventDefault();
        event.stopImmediatePropagation();
        downloadCsv();
      }
    },true);

    document.addEventListener('change',event=>{
      if(
        event.target.id==='ga-import' ||
        event.target.id==='importBackup'
      ) {
        event.stopImmediatePropagation();
        importData(event.target.files?.[0]);
      }
    },true);
  }

  if(document.readyState==='loading') {
    document.addEventListener(
      'DOMContentLoaded',start,{once:true}
    );
  } else {
    start();
  }
})();
