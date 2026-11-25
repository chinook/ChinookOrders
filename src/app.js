'use strict';
// Devise affichée (modifier ici si besoin : 'CAD', 'EUR', 'USD', 'CHF'...)
const CURRENCY = 'CAD';
const money = (n) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: CURRENCY }).format(n || 0);
const dateFmt = (t) => new Date(t).toLocaleDateString('fr-CA');

const STATUS_LABEL = { en_attente: 'En attente', approuve: 'Approuvé', refuse: 'Refusé', commande: 'Commandé' };
const ROLE_LABEL = { membre: 'Membre', approbateur: 'Approbateur', admin: 'Administrateur', generateur: 'Générateur de fiches de dépenses' };

const S = { me: null, departments: [], items: [], users: [], expenseRefs: null, view: null, tab: 'apercu', filter: 'tous', query: '', sort: 'recent', groupBySite: false };
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
  const valid = (v) => (v === 'all' && canApprove()) || (v === 'admin' && S.me.role === 'admin') || (v === 'refs' && canGenerate())
    || S.departments.some((d) => 'dept:' + d.id === v);
  if (!valid(S.view)) {
    S.view = canApprove() ? 'all' : (S.departments[0] ? 'dept:' + S.departments[0].id : (canGenerate() ? 'refs' : 'all'));
  }
  render();
}
const canApprove = () => S.me && (S.me.role === 'approbateur' || S.me.role === 'admin');
const canGenerate = () => S.me && (S.me.role === 'generateur' || S.me.role === 'admin');
const userName = (id) => (S.users.find((u) => u.id === id) || {}).name || '—';
const deptName = (id) => (S.departments.find((d) => d.id === id) || {}).name || '—';
const lineTotal = (i) => i.unitPrice * i.quantity;
const sum = (items) => items.reduce((t, i) => t + lineTotal(i), 0);
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

// Petit message temporaire en bas à droite
function toast(message, kind = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', role: 'status' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind }, message);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3000);
}

async function run(fn, success) {
  try { await fn(); await refresh(); if (success) toast(success); }
  catch (e) { if (e.message !== 'Session expirée') toast(e.message, 'bad'); }
}

// Confirmation aux couleurs du club ; retourne une promesse (true = confirmé)
function confirmDialog(message, label = 'Supprimer') {
  return new Promise((resolve) => {
    const dlg = h('dialog', {});
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(h('h3', {}, 'Confirmation'), h('p', {}, message),
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn', autofocus: true, onclick: () => done(false) }, 'Annuler'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => done(true) }, label)));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    document.body.append(dlg);
    dlg.showModal();
  });
}
const confirmDelete = async (message, fn, success) => { if (await confirmDialog(message)) await run(fn, success); };

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
  h('img', { src: 'logo-nuit.png', class: 'login-logo', alt: 'ChinookOrders' }),
  h('p', {}, "Listes d'achats par département"),
  error && h('div', { class: 'err' }, error),
  h('label', {}, "Nom d'utilisateur", h('input', { name: 'username', autocomplete: 'username', autofocus: true, required: true })),
  h('label', {}, 'Mot de passe', h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
  h('button', { class: 'btn primary', style: 'width:100%' }, 'Se connecter'));
  root.replaceChildren(f);
}

// ---------- Dialogues ----------
function dialog(title, body, { onSubmit, submitLabel = 'Enregistrer', cancel = true, success }) {
  const dlg = h('dialog', {});
  const err = h('div', { class: 'err', hidden: true });
  const form = h('form', { method: 'dialog', onsubmit: async (e) => {
    e.preventDefault();
    try { await onSubmit(form); dlg.close(); dlg.remove(); await refresh(); if (success) toast(success); }
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

// Pop-up avec le PDF « Liste des numéros de compte » (se ferme pour revenir au formulaire)
function pdfAccountsDialog() {
  const dlg = h('dialog', { class: 'pdf-dlg' });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(
    h('div', { class: 'pdf-head' }, h('h3', {}, 'Liste des numéros de compte'),
      h('button', { type: 'button', class: 'btn', onclick: close }, 'Fermer')),
    h('iframe', { src: 'docs/liste-comptes.pdf', title: 'Liste des numéros de compte', class: 'pdf-frame' }));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  dlg.showModal();
}

function itemDialog(item) {
  const counter = h('div', { class: 'hint', style: 'text-align:right' });
  const currentDept = item ? item.departmentId : (S.view.startsWith('dept:') ? S.view.slice(5) : (S.me.departmentId || S.departments[0]?.id));
  const body = h('div', {},
    S.departments.length > 1 && h('label', {}, 'Département',
      h('select', { name: 'departmentId' }, S.departments.map((d) => h('option', { value: d.id, selected: d.id === currentDept }, d.name)))),
    h('label', {}, 'Pièce / article', h('input', { name: 'name', required: true, maxLength: 200, value: item?.name || '' })),
    h('label', {}, 'Lien du produit', h('input', { name: 'url', type: 'text', placeholder: 'https://…', value: item?.url || '' })),
    h('div', { class: 'grid2' },
      h('label', {}, 'Prix unitaire (hors livraison)', h('input', { name: 'unitPrice', type: 'number', step: '0.01', min: '0', required: true, value: item?.unitPrice ?? '' })),
      h('label', {}, 'Quantité', h('input', { name: 'quantity', type: 'number', min: '1', step: '1', required: true, value: item?.quantity ?? 1 }))),
    h('label', {}, 'Numéro de compte',
      h('div', { class: 'inline' },
        h('input', { name: 'accountNumber', required: true, maxLength: 5, pattern: '\\d{5}', inputMode: 'numeric', placeholder: '5 chiffres, ex. 54121', title: '5 chiffres', autocomplete: 'off', value: item?.accountNumber || '' }),
        h('button', { type: 'button', class: 'btn', style: 'white-space:nowrap', onclick: pdfAccountsDialog }, 'Liste des comptes'))),
    h('label', {}, 'Description (obligatoire, 200 caractères max.)',
      h('textarea', { name: 'description', rows: 3, required: true, maxLength: 200, value: item?.description || '',
        oninput: (e) => { counter.textContent = `${e.target.value.length} / 200`; } }),
      counter),
    item && item.status !== 'en_attente' && h('p', { class: 'hint' }, 'Modifier cette pièce la remettra « En attente » d’approbation.'));
  counter.textContent = `${(item?.description || '').length} / 200`;
  dialog(item ? 'Modifier la pièce' : 'Ajouter une pièce', body, {
    success: item ? 'Pièce modifiée' : 'Pièce ajoutée',
    onSubmit: (f) => {
      const payload = { name: f.name.value, url: f.url.value, unitPrice: f.unitPrice.value, quantity: f.quantity.value,
        accountNumber: f.accountNumber.value, description: f.description.value };
      payload.departmentId = f.departmentId ? f.departmentId.value : currentDept;
      if (item) return api('PUT', '/api/items/' + item.id, payload);
      return api('POST', '/api/items', payload);
    },
  });
}

function rejectDialog(item) {
  dialog('Refuser « ' + item.name + ' »', h('label', {}, 'Motif (facultatif)', h('input', { name: 'reason', maxLength: 300 })), {
    submitLabel: 'Refuser',
    success: 'Pièce refusée',
    onSubmit: (f) => api('POST', `/api/items/${item.id}/status`, { status: 'refuse', reason: f.reason.value }),
  });
}

function passwordDialog(forced) {
  dialog(forced ? 'Choisissez un nouveau mot de passe' : 'Changer mon mot de passe',
    h('div', {},
      h('label', {}, 'Mot de passe actuel', h('input', { name: 'old', type: 'password', required: true, autocomplete: 'current-password' })),
      h('label', {}, 'Nouveau mot de passe', h('input', { name: 'nw', type: 'password', required: true, minLength: 4, autocomplete: 'new-password' }))),
    { cancel: !forced, success: 'Mot de passe changé', onSubmit: (f) => api('POST', '/api/password', { oldPassword: f.old.value, newPassword: f.nw.value }) });
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
    h('p', { class: 'hint' }, 'Membre : voit et alimente son département. Approbateur : voit tout, approuve/refuse et marque « commandé ». Administrateur : en plus, gère utilisateurs et départements. Générateur de fiches de dépenses : génère les numéros de référence CHI26XX (aucun département requis).'));
  dialog(user ? 'Modifier ' + user.name : 'Nouvel utilisateur', body, {
    success: user ? 'Utilisateur modifié' : 'Utilisateur créé',
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
      h('img', { src: 'logo-nuit.png', class: 'logo', alt: '' }),
      h('h1', {}, 'ChinookOrders'),
      h('button', { class: 'btn sm', title: 'Recharger les données (utile si le fichier est partagé)', onclick: () => run(async () => {}, 'Données actualisées') }, 'Actualiser')),
    h('div', { class: 'layout' }, renderSide(), S.view === 'admin' ? renderAdmin() : S.view === 'refs' ? renderRefs() : renderItems()));
}

// ---------- Fiches de dépenses : numéros de référence ----------
function renderRefs() {
  const refs = (S.expenseRefs || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const last = refs.slice().sort((a, b) => a.prefix === b.prefix ? b.number - a.number : b.prefix.localeCompare(a.prefix))[0];
  const addInput = h('input', { placeholder: 'Ancien numéro, ex. CHI2603', maxLength: 20 });
  return h('main', { class: 'main' },
    h('div', { class: 'head' }, h('h2', {}, 'Fiches de dépenses'),
      h('button', { class: 'btn primary', onclick: () => run(async () => {
        const r = await api('POST', '/api/refs/generate');
        dialog('Nouveau numéro de référence', h('p', { class: 'newref' }, r.ref), { submitLabel: 'OK', cancel: false, onSubmit: async () => {} });
      }) }, '+ Générer un nouveau numéro')),
    h('div', { class: 'totals' },
      h('div', { class: 'tile main-total' }, h('div', { class: 'lbl' }, 'Dernier numéro utilisé'), h('div', { class: 'val' }, last ? last.ref : '—'),
        h('div', { class: 'sub' }, 'Le prochain sera ' + nextRef(last))),
      h('div', { class: 'tile' }, h('div', { class: 'lbl' }, 'Numéros enregistrés'), h('div', { class: 'val' }, refs.length))),
    h('div', { class: 'panel' }, h('h3', {}, 'Anciens numéros de référence'),
      refs.length === 0 ? h('div', { class: 'empty' }, 'Aucun numéro pour le moment.') : refs.map((r) => h('div', { class: 'row' },
        h('strong', { class: 'ref' }, r.ref),
        h('span', { class: 'grow note' }, `${dateFmt(r.createdAt)} · ${userName(r.createdBy)}${r.imported ? ' · ajouté manuellement' : ''}`),
        S.me.role === 'admin' && h('button', { class: 'btn sm danger', onclick: () => confirmDelete(`Supprimer ${r.ref} ?`, () => api('DELETE', '/api/refs/' + r.id), 'Numéro supprimé') }, 'Supprimer')))),
    h('div', { class: 'panel' }, h('h3', {}, 'Ajouter un numéro déjà utilisé'),
      h('p', { class: 'note', style: 'margin:0 0 8px' }, 'Pour reprendre l’historique d’avant l’application : le prochain numéro généré continuera après le plus élevé.'),
      h('form', { class: 'inline', onsubmit: (e) => { e.preventDefault(); if (addInput.value.trim()) run(() => api('POST', '/api/refs', { ref: addInput.value }), 'Numéro ajouté'); } },
        addInput, h('button', { class: 'btn' }, 'Ajouter'))));
}
function nextRef(last) {
  const yy = String(new Date().getFullYear()).slice(-2);
  if (!last || last.prefix !== 'CHI' + yy) return 'CHI' + yy + '00';
  return last.prefix + String(last.number + 1).padStart(2, '0');
}

const ICONS = {
  "grid": "<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/>",
  "clock": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>",
  "folder": "<path d=\"M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z\"/>",
  "receipt": "<path d=\"M6 3h12v18l-3-2-3 2-3-2-3 2z\"/><path d=\"M9 8h6M9 12h6\"/>",
  "settings": "<path d=\"M4 7h10M18 7h2M4 17h2M10 17h10\"/><circle cx=\"16\" cy=\"7\" r=\"2\"/><circle cx=\"8\" cy=\"17\" r=\"2\"/>",
  "key": "<circle cx=\"8\" cy=\"15\" r=\"4\"/><path d=\"M11 12l9-9M17 6l3 3\"/>",
  "logout": "<path d=\"M10 4H5v16h5M15 8l4 4-4 4M19 12H9\"/>"
};
function icon(name) {
  const span = h('span', { class: 'ico' });
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}

function go(view, { tab = 'apercu', filter = 'tous' } = {}) {
  Object.assign(S, { view, tab, filter, query: '' });
  render();
}

function renderSide() {
  const nav = (ico, label, onclick, { active, amount, badge } = {}) => h('button', { class: active ? 'active' : '', onclick },
    icon(ico), h('span', { class: 'grow' }, label),
    amount != null && h('span', { class: 'amt' }, amount),
    badge > 0 && h('span', { class: 'badge en_attente' }, badge));
  const pending = S.items.filter((i) => i.status === 'en_attente').length;
  const live = (items) => sum(items.filter((i) => i.status !== 'refuse'));
  const logout = async () => { await api('POST', '/api/logout'); S.me = null; renderLogin(); };
  return h('nav', { class: 'side' },
    canApprove() && nav('grid', 'Tous les départements', () => go('all'), { active: S.view === 'all', amount: money(live(S.items)) }),
    canApprove() && pending > 0 && nav('clock', 'À approuver', () => go('all', { tab: 'pieces', filter: 'en_attente' }), { badge: pending }),
    S.departments.length > 0 && h('div', { class: 'side-title' }, 'Départements'),
    S.departments.map((d) => nav('folder', d.name, () => go('dept:' + d.id), { active: S.view === 'dept:' + d.id, amount: money(live(S.items.filter((i) => i.departmentId === d.id))) })),
    (canGenerate() || S.me.role === 'admin') && h('hr'),
    canGenerate() && nav('receipt', 'Fiches de dépenses', () => go('refs'), { active: S.view === 'refs', amount: S.expenseRefs ? S.expenseRefs.length + ' n°' : null }),
    S.me.role === 'admin' && nav('settings', 'Administration', () => go('admin'), { active: S.view === 'admin' }),
    h('div', { class: 'side-foot' },
      h('div', { class: 'who' }, h('strong', {}, S.me.name), ROLE_LABEL[S.me.role] !== S.me.name && h('span', {}, ROLE_LABEL[S.me.role])),
      nav('key', 'Mot de passe', () => passwordDialog(false)),
      nav('logout', 'Déconnexion', logout)));
}

const SORTS = {
  recent: ['Plus récentes', (a, b) => b.createdAt - a.createdAt],
  ancien: ['Plus anciennes', (a, b) => a.createdAt - b.createdAt],
  cher: ['Total le plus élevé', (a, b) => lineTotal(b) - lineTotal(a)],
  moins: ['Total le moins élevé', (a, b) => lineTotal(a) - lineTotal(b)],
  nom: ['Nom (A à Z)', (a, b) => a.name.localeCompare(b.name, 'fr')],
};
// Recherche sans tenir compte des majuscules ni des accents
const fold = (t) => String(t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function renderItems() {
  const deptId = S.view.startsWith('dept:') ? S.view.slice(5) : null;
  const scope = deptId ? S.items.filter((i) => i.departmentId === deptId) : S.items;
  const by = (s) => scope.filter((i) => i.status === s);
  const title = deptId ? deptName(deptId) : 'Tous les départements';
  const live = scope.filter((i) => i.status !== 'refuse');
  const showOverview = !deptId && S.view === 'all' && S.tab === 'apercu';

  const tile = (cls, lbl, val, sub) => h('div', { class: 'tile ' + cls }, h('div', { class: 'lbl' }, lbl), h('div', { class: 'val' }, val), sub && h('div', { class: 'sub' }, sub));
  const count = (n) => `${n} pièce${n > 1 ? 's' : ''}`;
  const tab = (id, label) => h('button', { class: S.tab === id ? 'active' : '', onclick: () => { S.tab = id; render(); } }, label);

  return h('main', { class: 'main' },
    h('div', { class: 'head' },
      h('h2', {}, title),
      (deptId || S.me.departmentId || S.departments.length > 0) && h('button', { class: 'btn primary', onclick: () => itemDialog() }, '+ Ajouter une pièce')),
    !deptId && h('div', { class: 'tabs' }, tab('apercu', 'Vue d’ensemble'), tab('pieces', `Pièces (${scope.length})`)),
    h('div', { class: 'totals' },
      tile('main-total', 'Total (hors livraison)', money(sum(live)), count(live.length) + ' · refusés exclus'),
      tile('', 'À approuver', money(sum(by('en_attente'))), count(by('en_attente').length)),
      tile('', 'À commander', money(sum(by('approuve'))), count(by('approuve').length)),
      tile('', 'Commandé', money(sum(by('commande'))), count(by('commande').length))),
    showOverview ? renderOverview() : renderList(scope, !deptId));
}

function renderList(scope, showDept) {
  const by = (s) => scope.filter((i) => i.status === s);
  const results = h('div', {});
  // Seuls les résultats sont redessinés : le champ de recherche garde le curseur
  const paint = () => {
    const q = fold(S.query.trim());
    const shown = (S.filter === 'tous' ? scope : by(S.filter))
      .filter((i) => !q || fold([i.name, i.description, host(i.url), i.accountNumber].join(' ')).includes(q))
      .sort(SORTS[S.sort][1]);
    results.replaceChildren(shown.length === 0
      ? h('div', { class: 'tablewrap' }, h('div', { class: 'empty' }, q ? 'Aucune pièce ne correspond à la recherche.' : 'Aucune pièce ici pour le moment.'))
      : renderTable(shown, showDept));
  };
  paint();
  return h('div', {},
    h('div', { class: 'toolbar' },
      h('input', { type: 'search', class: 'search', placeholder: 'Chercher : nom, site, n° de compte…', value: S.query, oninput: (e) => { S.query = e.target.value; paint(); } }),
      h('select', { class: 'sort', title: 'Trier', onchange: (e) => { S.sort = e.target.value; paint(); } },
        Object.entries(SORTS).map(([v, [l]]) => h('option', { value: v, selected: S.sort === v }, l))),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: S.groupBySite, onchange: (e) => { S.groupBySite = e.target.checked; paint(); } }),
        'Grouper par site')),
    h('div', { class: 'filters' },
      ['tous', 'en_attente', 'approuve', 'commande', 'refuse'].map((f) => h('button', {
        class: 'chip' + (S.filter === f ? ' active' : ''),
        onclick: () => { S.filter = f; render(); },
      }, f === 'tous' ? `Tous (${scope.length})` : `${STATUS_LABEL[f]} (${by(f).length})`))),
    results);
}

// Vue d'ensemble : une carte par département (coût, part du budget, statuts).
function renderOverview() {
  if (S.departments.length === 0 || S.items.length === 0) return h('div', { class: 'tablewrap' }, h('div', { class: 'empty' }, 'Aucune pièce pour le moment.'));
  const live = (items) => items.filter((i) => i.status !== 'refuse');
  const globalCost = sum(live(S.items));
  const stats = S.departments.map((d) => {
    const items = S.items.filter((i) => i.departmentId === d.id);
    const n = (s) => items.filter((i) => i.status === s).length;
    return { d, cost: sum(live(items)), count: items.length,
      st: { en_attente: n('en_attente'), approuve: n('approuve'), commande: n('commande'), refuse: n('refuse') } };
  }).sort((a, b) => b.cost - a.cost);

  const card = (s) => {
    const pct = globalCost ? Math.round((s.cost / globalCost) * 100) : 0;
    const total = s.count || 1;
    return h('button', { class: 'dcard', title: `Ouvrir ${s.d.name}`, onclick: () => go('dept:' + s.d.id) },
      h('div', { class: 'dc-name' }, s.d.name),
      h('div', { class: 'dc-cost' }, money(s.cost)),
      h('div', { class: 'share' }, h('i', { style: `width:${pct}%` })),
      h('div', { class: 'dc-sub' }, `${pct} % du budget total · ${s.count} pièce${s.count > 1 ? 's' : ''}`),
      s.st.en_attente > 0 && h('div', {}, h('span', { class: 'badge en_attente' }, s.st.en_attente + ' à approuver')),
      h('div', { class: 'stackbar', title: `En attente ${s.st.en_attente} · Approuvé ${s.st.approuve} · Commandé ${s.st.commande} · Refusé ${s.st.refuse}` },
        ['en_attente', 'approuve', 'commande', 'refuse'].map((k) => s.st[k] > 0 && h('i', { class: k, style: `width:${(s.st[k] / total) * 100}%` }))));
  };

  return h('section', { class: 'overview' },
    h('h3', { class: 'ov-title' }, 'Par département'),
    h('div', { class: 'dgrid' }, stats.map(card)),
    h('div', { class: 'legend' }, h('span', {}, 'Barre du bas, statut des pièces :'),
      ['en_attente', 'approuve', 'commande', 'refuse'].map((k) => h('span', {}, h('i', { class: k }), STATUS_LABEL[k]))));
}

// Menu « ⋯ » d'une ligne (popover natif : jamais coupé par le défilement du tableau)
function rowMenu(name, entries) {
  const pop = h('div', { class: 'menu', popover: 'auto' },
    entries.map(([label, cls, fn]) => h('button', { type: 'button', class: cls, onclick: () => { pop.hidePopover(); fn(); } }, label)));
  const btn = h('button', { type: 'button', class: 'btn sm more', title: 'Autres actions', 'aria-label': 'Autres actions pour ' + name }, '⋯');
  btn.popoverTargetElement = pop;
  pop.addEventListener('toggle', (e) => {
    if (e.newState !== 'open') return;
    const r = btn.getBoundingClientRect();
    const below = r.bottom + 4 + pop.offsetHeight <= window.innerHeight;
    pop.style.top = (below ? r.bottom + 4 : r.top - 4 - pop.offsetHeight) + 'px';
    pop.style.left = (r.right - pop.offsetWidth) + 'px';
  });
  return [btn, pop];
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
  const setStatus = (status, msg) => run(() => api('POST', `/api/items/${i.id}/status`, { status }), msg);
  const del = () => confirmDelete(`Supprimer « ${i.name} » ?`, () => api('DELETE', '/api/items/' + i.id), 'Pièce supprimée');
  const backToPending = () => setStatus('en_attente', 'Pièce remise en attente');

  // Action principale visible ; le reste dans le menu « ⋯ »
  const main = !approver ? null
    : i.status === 'en_attente' ? ['Approuver', 'ok', () => setStatus('approuve', 'Pièce approuvée')]
    : i.status === 'approuve' ? ['Marquer commandé', 'primary', () => setStatus('commande', 'Pièce marquée comme commandée')]
    : i.status === 'refuse' ? ['Remettre en attente', '', backToPending]
    : null;
  const more = [
    approver && i.status === 'en_attente' && ['Refuser', 'danger', () => rejectDialog(i)],
    canEdit && ['Modifier', '', () => itemDialog(i)],
    approver && i.status === 'approuve' && ['Remettre en attente', '', backToPending],
    approver && i.status === 'commande' && ['Annuler commande', '', () => setStatus('approuve', 'Commande annulée')],
    canDelete && ['Supprimer', 'danger', del],
  ].filter(Boolean);

  const meta = [
    showDept && deptName(i.departmentId),
    i.accountNumber ? 'compte ' + i.accountNumber : 'compte non indiqué',
    'ajouté par ' + userName(i.createdBy) + ' le ' + dateFmt(i.createdAt),
    i.decidedBy && `${STATUS_LABEL[i.status].toLowerCase()} par ${userName(i.decidedBy)}`,
  ].filter(Boolean).join(' · ');

  return h('tr', { class: i.status },
    h('td', {}, h('div', { class: 'name' }, i.name),
      i.description && h('div', { class: 'note' }, i.description),
      i.status === 'refuse' && i.rejectReason && h('div', { class: 'note keep' }, 'Motif : ' + i.rejectReason),
      h('div', { class: 'dept-tag' }, meta)),
    h('td', {}, i.url ? h('a', { class: 'site', href: i.url, target: '_blank', rel: 'noopener noreferrer' }, host(i.url) + ' ↗') : '—'),
    h('td', { class: 'num' }, money(i.unitPrice)),
    h('td', { class: 'num' }, i.quantity),
    h('td', { class: 'num' }, h('strong', {}, money(lineTotal(i)))),
    h('td', { class: 'keep' }, h('span', { class: 'badge ' + i.status }, STATUS_LABEL[i.status])),
    h('td', { class: 'keep' }, h('div', { class: 'actions' },
      main && h('button', { class: 'btn sm ' + main[1], onclick: main[2] }, main[0]),
      more.length > 0 && rowMenu(i.name, more))));
}

// ---------- Administration ----------
function renderAdmin() {
  const newDept = h('input', { placeholder: 'Nom du nouveau département', maxLength: 80 });
  return h('main', { class: 'main' },
    h('div', { class: 'head' }, h('h2', {}, 'Administration')),
    h('div', { class: 'panel' }, h('h3', {}, 'Départements'),
      S.departments.map((d) => h('div', { class: 'row' },
        h('span', { class: 'grow' }, d.name),
        h('span', { class: 'note' }, `${S.items.filter((i) => i.departmentId === d.id).length} pièce(s)`),
        h('button', { class: 'btn sm', onclick: () => dialog('Renommer le département',
          h('label', {}, 'Nouveau nom', h('input', { name: 'name', required: true, maxLength: 80, value: d.name })),
          { success: 'Département renommé', onSubmit: (f) => api('PUT', '/api/departments/' + d.id, { name: f.name.value }) }) }, 'Renommer'),
        h('button', { class: 'btn sm danger', onclick: () => confirmDelete(`Supprimer le département « ${d.name} » ?`, () => api('DELETE', '/api/departments/' + d.id), 'Département supprimé') }, 'Supprimer'))),
      h('form', { class: 'inline', style: 'margin-top:10px', onsubmit: (e) => { e.preventDefault(); if (newDept.value.trim()) run(() => api('POST', '/api/departments', { name: newDept.value }), 'Département ajouté'); } },
        newDept, h('button', { class: 'btn primary' }, 'Ajouter'))),
    h('div', { class: 'panel' }, h('h3', {}, 'Utilisateurs'),
      S.users.map((u) => h('div', { class: 'row' },
        h('span', { class: 'grow' }, h('strong', {}, u.name), ` (${u.username}) `, h('span', { class: 'note' }, `${ROLE_LABEL[u.role]}${u.departmentId ? ' · ' + deptName(u.departmentId) : ''}`)),
        h('button', { class: 'btn sm', onclick: () => userDialog(u) }, 'Modifier'),
        u.id !== S.me.id && h('button', { class: 'btn sm danger', onclick: () => confirmDelete(`Supprimer l’utilisateur ${u.name} ?`, () => api('DELETE', '/api/users/' + u.id), 'Utilisateur supprimé') }, 'Supprimer'))),
      h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn primary', onclick: () => userDialog() }, '+ Nouvel utilisateur'))),
    h('div', { class: 'panel' }, h('h3', {}, 'Emplacement des données'),
      h('p', { class: 'note', style: 'margin:0 0 8px' },
        'Pour que plusieurs personnes partagent les mêmes listes, placez le dossier des données sur un lecteur réseau ou partagé, puis choisissez ce même dossier sur chaque poste.'),
      h('div', { class: 'row' },
        h('code', { class: 'grow', style: 'word-break:break-all' }, S.dataDir || ''),
        h('button', { class: 'btn sm', onclick: () => window.pont.ouvrirDossierDonnees() }, 'Ouvrir'),
        h('button', { class: 'btn sm', onclick: async () => {
          const r = await window.pont.choisirDossierDonnees();
          if (!r.ok) toast(r.error, 'bad'); else if (r.changed) await refresh();
        } }, 'Changer…'))));
}

// ---------- Démarrage ----------
refresh().then(() => { if (S.me.mustChangePassword) passwordDialog(true); }).catch(() => renderLogin());
