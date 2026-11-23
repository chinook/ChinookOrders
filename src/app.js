'use strict';
// Devise affichée (modifier ici si besoin : 'CAD', 'EUR', 'USD', 'CHF'...)
const CURRENCY = 'CAD';
const money = (n) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: CURRENCY }).format(n || 0);
const dateFmt = (t) => new Date(t).toLocaleDateString('fr-CA');

const STATUS_LABEL = { en_attente: 'En attente', approuve: 'Approuvé', refuse: 'Refusé', commande: 'Commandé' };
const ROLE_LABEL = { membre: 'Membre', approbateur: 'Approbateur', admin: 'Administrateur' };

const S = { me: null, departments: [], items: [], users: [], view: null, filter: 'tous', groupBySite: false };
const root = document.getElementById('app');

// ---------- Utilitaires ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el[k] = v;
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function api(method, url, body) {
  const res = await window.pont.requete(method, url, body);
  if (res.status === 401 && url !== '/api/login') { S.me = null; renderLogin(); throw new Error('Session expirée'); }
  if (!res.ok) throw new Error(res.error || 'Erreur');
  return res.data;
}

async function refresh() {
  Object.assign(S, await api('GET', '/api/state'));
  const valid = (v) => v === 'all' || v === 'admin' || S.departments.some((d) => 'dept:' + d.id === v);
  if (!valid(S.view) || (S.view === 'admin' && S.me.role !== 'admin')) {
    S.view = canApprove() ? 'all' : (S.departments[0] ? 'dept:' + S.departments[0].id : 'all');
  }
  render();
}
const canApprove = () => S.me && (S.me.role === 'approbateur' || S.me.role === 'admin');
const userName = (id) => (S.users.find((u) => u.id === id) || {}).name || '—';
const deptName = (id) => (S.departments.find((d) => d.id === id) || {}).name || '—';
const lineTotal = (i) => i.unitPrice * i.quantity;
const sum = (items) => items.reduce((t, i) => t + lineTotal(i), 0);
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

async function run(fn) {
  try { await fn(); await refresh(); } catch (e) { if (e.message !== 'Session expirée') alert(e.message); }
}

// ---------- Connexion ----------
function renderLogin(error) {
  const f = h('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/login', { username: f.username.value, password: f.password.value });
      await refresh();
      if (S.me.mustChangePassword) passwordDialog(true);
    } catch (err) { renderLogin(err.message); }
  } },
  h('img', { src: 'logo.png', class: 'login-logo', alt: 'ChinookOrders' }),
  h('p', {}, "Listes d'achats par département"),
  error && h('div', { class: 'err' }, error),
  h('label', {}, "Nom d'utilisateur", h('input', { name: 'username', autocomplete: 'username', autofocus: true, required: true })),
  h('label', {}, 'Mot de passe', h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
  h('button', { class: 'btn primary', style: 'width:100%' }, 'Se connecter'));
  root.replaceChildren(f);
}

// ---------- Dialogues ----------
function dialog(title, body, { onSubmit, submitLabel = 'Enregistrer', cancel = true }) {
  const dlg = h('dialog', {});
  const err = h('div', { class: 'err', hidden: true });
  const form = h('form', { method: 'dialog', onsubmit: async (e) => {
    e.preventDefault();
    try { await onSubmit(form); dlg.close(); dlg.remove(); await refresh(); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
  } },
  h('h3', {}, title), err, body,
  h('div', { class: 'dlg-actions' },
    cancel && h('button', { type: 'button', class: 'btn', onclick: () => { dlg.close(); dlg.remove(); } }, 'Annuler'),
    h('button', { class: 'btn primary' }, submitLabel)));
  dlg.append(form);
  if (!cancel) dlg.addEventListener('cancel', (e) => e.preventDefault());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function itemDialog(item) {
  const currentDept = S.view.startsWith('dept:') ? S.view.slice(5) : (S.me.departmentId || S.departments[0]?.id);
  const body = h('div', {},
    !item && S.departments.length > 1 && h('label', {}, 'Département',
      h('select', { name: 'departmentId' }, S.departments.map((d) => h('option', { value: d.id, selected: d.id === currentDept }, d.name)))),
    h('label', {}, 'Pièce / article', h('input', { name: 'name', required: true, maxLength: 200, value: item?.name || '' })),
    h('label', {}, 'Lien du produit', h('input', { name: 'url', type: 'text', placeholder: 'https://…', value: item?.url || '' })),
    h('div', { class: 'grid2' },
      h('label', {}, 'Prix unitaire (hors livraison)', h('input', { name: 'unitPrice', type: 'number', step: '0.01', min: '0', required: true, value: item?.unitPrice ?? '' })),
      h('label', {}, 'Quantité', h('input', { name: 'quantity', type: 'number', min: '1', step: '1', required: true, value: item?.quantity ?? 1 }))),
    h('label', {}, 'Note (facultatif)', h('textarea', { name: 'note', rows: 2, maxLength: 500, value: item?.note || '' })),
    item && item.status !== 'en_attente' && h('p', { class: 'hint' }, 'Modifier cette pièce la remettra « En attente » d’approbation.'));
  dialog(item ? 'Modifier la pièce' : 'Ajouter une pièce', body, {
    onSubmit: (f) => {
      const payload = { name: f.name.value, url: f.url.value, unitPrice: f.unitPrice.value, quantity: f.quantity.value, note: f.note.value };
      if (item) return api('PUT', '/api/items/' + item.id, payload);
      payload.departmentId = f.departmentId ? f.departmentId.value : currentDept;
      return api('POST', '/api/items', payload);
    },
  });
}

function rejectDialog(item) {
  dialog('Refuser « ' + item.name + ' »', h('label', {}, 'Motif (facultatif)', h('input', { name: 'reason', maxLength: 300 })), {
    submitLabel: 'Refuser',
    onSubmit: (f) => api('POST', `/api/items/${item.id}/status`, { status: 'refuse', reason: f.reason.value }),
  });
}

function passwordDialog(forced) {
  dialog(forced ? 'Choisissez un nouveau mot de passe' : 'Changer mon mot de passe',
    h('div', {},
      h('label', {}, 'Mot de passe actuel', h('input', { name: 'old', type: 'password', required: true, autocomplete: 'current-password' })),
      h('label', {}, 'Nouveau mot de passe', h('input', { name: 'nw', type: 'password', required: true, minLength: 4, autocomplete: 'new-password' }))),
    { cancel: !forced, onSubmit: (f) => api('POST', '/api/password', { oldPassword: f.old.value, newPassword: f.nw.value }) });
}

function userDialog(user) {
  const body = h('div', {},
    h('label', {}, 'Nom complet', h('input', { name: 'name', required: true, value: user?.name || '' })),
    !user && h('label', {}, "Nom d'utilisateur", h('input', { name: 'username', required: true, autocomplete: 'off' })),
    h('label', {}, user ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe temporaire',
      h('input', { name: 'password', type: 'text', autocomplete: 'off', required: !user, minLength: 4 })),
    h('div', { class: 'grid2' },
      h('label', {}, 'Rôle', h('select', { name: 'role' }, Object.entries(ROLE_LABEL).map(([v, l]) => h('option', { value: v, selected: user?.role === v }, l)))),
      h('label', {}, 'Département', h('select', { name: 'departmentId' },
        h('option', { value: '' }, '— Aucun —'),
        S.departments.map((d) => h('option', { value: d.id, selected: user?.departmentId === d.id }, d.name))))),
    h('p', { class: 'hint' }, 'Membre : voit et alimente son département. Approbateur : voit tout, approuve/refuse et marque « commandé ». Administrateur : en plus, gère utilisateurs et départements.'));
  dialog(user ? 'Modifier ' + user.name : 'Nouvel utilisateur', body, {
    onSubmit: (f) => {
      const payload = { name: f.name.value, role: f.role.value, departmentId: f.departmentId.value, password: f.password.value };
      if (user) return api('PUT', '/api/users/' + user.id, payload);
      payload.username = f.username.value;
      return api('POST', '/api/users', payload);
    },
  });
}

// ---------- Rendu principal ----------
function render() {
  if (!S.me) return renderLogin();
  root.replaceChildren(
    h('div', { class: 'topbar' },
      h('img', { src: 'logo.png', class: 'logo', alt: '' }),
      h('h1', {}, 'ChinookOrders'),
      h('span', { class: 'who' }, `${S.me.name} · ${ROLE_LABEL[S.me.role]}`),
      h('button', { class: 'btn sm', title: 'Recharger les données (utile si le fichier est partagé)', onclick: () => run(async () => {}) }, 'Actualiser'),
      h('button', { class: 'btn sm', onclick: () => passwordDialog(false) }, 'Mot de passe'),
      h('button', { class: 'btn sm', onclick: async () => { await api('POST', '/api/logout'); S.me = null; renderLogin(); } }, 'Déconnexion')),
    h('div', { class: 'layout' }, renderSide(), S.view === 'admin' ? renderAdmin() : renderItems()));
}

function renderSide() {
  const nav = (view, label, amount, extra) => h('button', {
    class: S.view === view && !extra ? 'active' : '',
    onclick: () => { S.view = view; S.filter = extra || 'tous'; render(); },
  }, h('span', {}, label), amount != null && h('span', { class: 'amt' }, amount));
  const pending = S.items.filter((i) => i.status === 'en_attente').length;
  const live = (items) => sum(items.filter((i) => i.status !== 'refuse'));
  return h('nav', { class: 'side' },
    canApprove() && nav('all', 'Tous les départements', money(live(S.items))),
    canApprove() && pending > 0 && h('button', {
      onclick: () => { S.view = 'all'; S.filter = 'en_attente'; render(); },
    }, h('span', {}, '⏳ À approuver'), h('span', { class: 'badge en_attente' }, pending)),
    canApprove() && h('hr'),
    S.departments.map((d) => nav('dept:' + d.id, d.name, money(live(S.items.filter((i) => i.departmentId === d.id))))),
    S.me.role === 'admin' && h('hr'),
    S.me.role === 'admin' && nav('admin', '⚙ Administration'));
}

function renderItems() {
  const deptId = S.view.startsWith('dept:') ? S.view.slice(5) : null;
  const scope = deptId ? S.items.filter((i) => i.departmentId === deptId) : S.items;
  const by = (s) => scope.filter((i) => i.status === s);
  const shown = (S.filter === 'tous' ? scope : by(S.filter)).slice().sort((a, b) => b.createdAt - a.createdAt);
  const title = deptId ? deptName(deptId) : 'Tous les départements';
  const live = scope.filter((i) => i.status !== 'refuse');

  const tile = (cls, lbl, val, sub) => h('div', { class: 'tile ' + cls }, h('div', { class: 'lbl' }, lbl), h('div', { class: 'val' }, val), sub && h('div', { class: 'sub' }, sub));
  const count = (n) => `${n} pièce${n > 1 ? 's' : ''}`;

  return h('main', { class: 'main' },
    h('div', { class: 'head' },
      h('h2', {}, title),
      h('label', { style: 'margin:0;display:flex;gap:6px;align-items:center' },
        h('input', { type: 'checkbox', style: 'width:auto;margin:0', checked: S.groupBySite, onchange: (e) => { S.groupBySite = e.target.checked; render(); } }),
        'Grouper par site'),
      (deptId || S.me.departmentId || S.departments.length > 0) && h('button', { class: 'btn primary', onclick: () => itemDialog() }, '+ Ajouter une pièce')),
    h('div', { class: 'totals' },
      tile('main-total', 'Total global (hors livraison)', money(sum(live)), count(live.length) + ' · refusés exclus'),
      tile('', 'En attente', money(sum(by('en_attente'))), count(by('en_attente').length)),
      tile('', 'Approuvé, à commander', money(sum(by('approuve'))), count(by('approuve').length)),
      tile('', 'Déjà commandé', money(sum(by('commande'))), count(by('commande').length))),
    h('div', { class: 'filters' },
      ['tous', 'en_attente', 'approuve', 'commande', 'refuse'].map((f) => h('button', {
        class: 'chip' + (S.filter === f ? ' active' : ''),
        onclick: () => { S.filter = f; render(); },
      }, f === 'tous' ? `Tous (${scope.length})` : `${STATUS_LABEL[f]} (${by(f).length})`))),
    shown.length === 0
      ? h('div', { class: 'tablewrap' }, h('div', { class: 'empty' }, 'Aucune pièce ici pour le moment.'))
      : renderTable(shown, !deptId));
}

function renderTable(items, showDept) {
  const head = h('tr', {},
    h('th', {}, 'Pièce'), h('th', {}, 'Site'), h('th', { class: 'num' }, 'Prix unit.'),
    h('th', { class: 'num' }, 'Qté'), h('th', { class: 'num' }, 'Total'), h('th', {}, 'Statut'), h('th', {}, ''));
  const rows = [];
  if (S.groupBySite) {
    const groups = new Map();
    for (const i of items) { const k = host(i.url) || '(sans lien)'; (groups.get(k) || groups.set(k, []).get(k)).push(i); }
    for (const [site, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      rows.push(h('tr', {}, h('td', { colSpan: 7, style: 'background:var(--bg);font-weight:600' },
        `${site} — ${list.length} pièce${list.length > 1 ? 's' : ''} — ${money(sum(list.filter((i) => i.status !== 'refuse')))}`)));
      list.forEach((i) => rows.push(itemRow(i, showDept)));
    }
  } else items.forEach((i) => rows.push(itemRow(i, showDept)));
  return h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, head), h('tbody', {}, rows)));
}

function itemRow(i, showDept) {
  const mine = i.createdBy === S.me.id;
  const approver = canApprove();
  const canEdit = i.status !== 'commande' && (approver || (mine && i.status !== 'approuve'));
  const canDelete = approver || (mine && i.status === 'en_attente');
  const act = (label, cls, fn) => h('button', { class: 'btn sm ' + cls, onclick: fn }, label);
  const setStatus = (status) => run(() => api('POST', `/api/items/${i.id}/status`, { status }));
  const del = () => { if (confirm(`Supprimer « ${i.name} » ?`)) run(() => api('DELETE', '/api/items/' + i.id)); };

  const meta = [
    showDept && deptName(i.departmentId),
    'ajouté par ' + userName(i.createdBy) + ' le ' + dateFmt(i.createdAt),
    i.decidedBy && `${STATUS_LABEL[i.status].toLowerCase()} par ${userName(i.decidedBy)}`,
  ].filter(Boolean).join(' · ');

  return h('tr', { class: i.status },
    h('td', {}, h('div', { class: 'name' }, i.name),
      i.note && h('div', { class: 'note' }, i.note),
      i.status === 'refuse' && i.rejectReason && h('div', { class: 'note keep' }, 'Motif : ' + i.rejectReason),
      h('div', { class: 'dept-tag' }, meta)),
    h('td', {}, i.url ? h('a', { href: i.url, target: '_blank', rel: 'noopener noreferrer' }, host(i.url) + ' ↗') : '—'),
    h('td', { class: 'num' }, money(i.unitPrice)),
    h('td', { class: 'num' }, i.quantity),
    h('td', { class: 'num' }, h('strong', {}, money(lineTotal(i)))),
    h('td', { class: 'keep' }, h('span', { class: 'badge ' + i.status }, STATUS_LABEL[i.status])),
    h('td', { class: 'keep' }, h('div', { class: 'actions' },
      approver && i.status === 'en_attente' && act('Approuver', 'ok', () => setStatus('approuve')),
      approver && i.status === 'en_attente' && act('Refuser', 'danger', () => rejectDialog(i)),
      approver && i.status === 'approuve' && act('Marquer commandé', 'primary', () => setStatus('commande')),
      approver && i.status === 'approuve' && act('Remettre en attente', '', () => setStatus('en_attente')),
      approver && i.status === 'refuse' && act('Remettre en attente', '', () => setStatus('en_attente')),
      approver && i.status === 'commande' && act('Annuler commande', '', () => setStatus('approuve')),
      canEdit && act('Modifier', '', () => itemDialog(i)),
      canDelete && act('Supprimer', 'danger', del))));
}

// ---------- Administration ----------
function renderAdmin() {
  const del = (msg, fn) => { if (confirm(msg)) run(fn); };
  const newDept = h('input', { placeholder: 'Nom du nouveau département', maxLength: 80 });
  return h('main', { class: 'main' },
    h('div', { class: 'head' }, h('h2', {}, 'Administration')),
    h('div', { class: 'panel' }, h('h3', {}, 'Départements'),
      S.departments.map((d) => h('div', { class: 'row' },
        h('span', { class: 'grow' }, d.name),
        h('span', { class: 'note' }, `${S.items.filter((i) => i.departmentId === d.id).length} pièce(s)`),
        h('button', { class: 'btn sm', onclick: () => dialog('Renommer le département',
          h('label', {}, 'Nouveau nom', h('input', { name: 'name', required: true, maxLength: 80, value: d.name })),
          { onSubmit: (f) => api('PUT', '/api/departments/' + d.id, { name: f.name.value }) }) }, 'Renommer'),
        h('button', { class: 'btn sm danger', onclick: () => del(`Supprimer le département « ${d.name} » ?`, () => api('DELETE', '/api/departments/' + d.id)) }, 'Supprimer'))),
      h('form', { class: 'inline', style: 'margin-top:10px', onsubmit: (e) => { e.preventDefault(); if (newDept.value.trim()) run(() => api('POST', '/api/departments', { name: newDept.value })); } },
        newDept, h('button', { class: 'btn primary' }, 'Ajouter'))),
    h('div', { class: 'panel' }, h('h3', {}, 'Utilisateurs'),
      S.users.map((u) => h('div', { class: 'row' },
        h('span', { class: 'grow' }, h('strong', {}, u.name), ` (${u.username}) `, h('span', { class: 'note' }, `${ROLE_LABEL[u.role]}${u.departmentId ? ' · ' + deptName(u.departmentId) : ''}`)),
        h('button', { class: 'btn sm', onclick: () => userDialog(u) }, 'Modifier'),
        u.id !== S.me.id && h('button', { class: 'btn sm danger', onclick: () => del(`Supprimer l’utilisateur ${u.name} ?`, () => api('DELETE', '/api/users/' + u.id)) }, 'Supprimer'))),
      h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn primary', onclick: () => userDialog() }, '+ Nouvel utilisateur'))),
    h('div', { class: 'panel' }, h('h3', {}, 'Emplacement des données'),
      h('p', { class: 'note', style: 'margin:0 0 8px' },
        'Pour que plusieurs personnes partagent les mêmes listes, placez le dossier des données sur un lecteur réseau ou partagé, puis choisissez ce même dossier sur chaque poste.'),
      h('div', { class: 'row' },
        h('code', { class: 'grow', style: 'word-break:break-all' }, S.dataDir || ''),
        h('button', { class: 'btn sm', onclick: () => window.pont.ouvrirDossierDonnees() }, 'Ouvrir'),
        h('button', { class: 'btn sm', onclick: async () => {
          const r = await window.pont.choisirDossierDonnees();
          if (!r.ok) alert(r.error); else if (r.changed) await refresh();
        } }, 'Changer…'))));
}

// ---------- Démarrage ----------
refresh().then(() => { if (S.me.mustChangePassword) passwordDialog(true); }).catch(() => renderLogin());
