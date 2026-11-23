// ChinookOrders — logique métier (processus principal d'Electron, sans serveur HTTP)
// Les données sont dans un fichier JSON relu avant chaque opération : le dossier
// peut donc être placé sur un lecteur partagé (OneDrive, réseau) pour plusieurs utilisateurs.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_NAME = 'chinook-orders.json';
const ROLES = ['membre', 'approbateur', 'admin'];
const STATUSES = ['en_attente', 'approuve', 'refuse', 'commande'];

let dataDir = null;
const dbFile = () => path.join(dataDir, DB_NAME);

// ---------- Base de données (fichier JSON) ----------
const uid = () => crypto.randomBytes(8).toString('hex');
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

let db;
function load() {
  if (fs.existsSync(dbFile())) { db = JSON.parse(fs.readFileSync(dbFile(), 'utf8')); return; }
  db = { departments: [{ id: uid(), name: 'Général' }], users: [], items: [] };
  db.users.push({
    id: uid(), username: 'admin', name: 'Administrateur', role: 'admin',
    departmentId: null, password: hashPassword('admin'), mustChangePassword: true,
  });
  save();
}
function save() {
  const tmp = dbFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, dbFile());
}
function setDataDir(dir) { fs.mkdirSync(dir, { recursive: true }); dataDir = dir; load(); }
const getDataDir = () => dataDir;
const dbExistsIn = (dir) => fs.existsSync(path.join(dir, DB_NAME));
function copyDbTo(dir) { fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(dbFile(), path.join(dir, DB_NAME)); }

// ---------- Erreurs et validation ----------
class AppError extends Error {}
const bad = (m) => new AppError(m);
const forbidden = () => new AppError('Droits insuffisants.');
const notFound = (m) => new AppError(m);

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function cleanUrl(v) {
  const s = str(v, 2000);
  if (!s) return '';
  let u;
  try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : 'https://' + s); } catch { throw bad('Lien invalide.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw bad('Le lien doit commencer par http(s).');
  return u.toString();
}
function cleanPrice(v) {
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 1e9) throw bad('Prix invalide.');
  return Math.round(n * 100) / 100;
}
function cleanQty(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 1e6) throw bad('Quantité invalide.');
  return n;
}

// ---------- Droits ----------
const canApprove = (u) => u.role === 'approbateur' || u.role === 'admin';
const isAdmin = (u) => u.role === 'admin';
const canSeeDept = (u, deptId) => canApprove(u) || u.departmentId === deptId;
const publicUser = (u) => ({
  id: u.id, username: u.username, name: u.name, role: u.role,
  departmentId: u.departmentId, mustChangePassword: !!u.mustChangePassword,
});

// ---------- Routes ----------
// Chaque gestionnaire reçoit { user, session, body, params } et retourne la réponse.
const routes = [];
const route = (method, pattern, handler, { auth = true } = {}) =>
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, auth });

route('POST', '/api/login', ({ session, body }) => {
  const user = db.users.find((u) => u.username.toLowerCase() === str(body.username).toLowerCase());
  if (!user || !checkPassword(String(body.password || ''), user.password)) throw bad('Identifiants incorrects.');
  session.userId = user.id;
  return { user: publicUser(user) };
}, { auth: false });

route('POST', '/api/logout', ({ session }) => { session.userId = null; return { ok: true }; });

route('POST', '/api/password', ({ user, body }) => {
  if (!checkPassword(String(body.oldPassword || ''), user.password)) throw bad('Ancien mot de passe incorrect.');
  if (String(body.newPassword || '').length < 4) throw bad('Nouveau mot de passe trop court (4 caractères minimum).');
  user.password = hashPassword(String(body.newPassword));
  user.mustChangePassword = false;
  save();
  return { ok: true };
});

route('GET', '/api/state', ({ user }) => {
  const users = db.users.map(publicUser);
  return {
    me: publicUser(user),
    departments: db.departments.filter((d) => canSeeDept(user, d.id)),
    items: db.items.filter((i) => canSeeDept(user, i.departmentId)),
    users: isAdmin(user) ? users : users.map(({ id, name }) => ({ id, name })),
    dataDir: isAdmin(user) ? dataDir : null,
  };
});

// --- Articles ---
function itemFields(body) {
  const name = str(body.name, 200);
  if (!name) throw bad('Le nom de la pièce est requis.');
  return { name, url: cleanUrl(body.url), unitPrice: cleanPrice(body.unitPrice), quantity: cleanQty(body.quantity ?? 1), note: str(body.note, 500) };
}
function findItem(id, user) {
  const item = db.items.find((i) => i.id === id);
  if (!item || !canSeeDept(user, item.departmentId)) throw notFound('Pièce introuvable.');
  return item;
}

route('POST', '/api/items', ({ user, body }) => {
  const departmentId = body.departmentId || user.departmentId;
  if (!db.departments.some((d) => d.id === departmentId)) throw bad('Département invalide.');
  if (!canSeeDept(user, departmentId)) throw forbidden();
  const item = { id: uid(), departmentId, ...itemFields(body), status: 'en_attente', createdBy: user.id, createdAt: Date.now() };
  db.items.push(item);
  save();
  return item;
});

route('PUT', '/api/items/:id', ({ user, body, params }) => {
  const item = findItem(params.id, user);
  if (item.status === 'commande') throw bad('Une pièce déjà commandée ne peut plus être modifiée.');
  if (!canApprove(user) && (item.createdBy !== user.id || item.status === 'approuve')) throw forbidden();
  Object.assign(item, itemFields(body));
  if (item.status !== 'en_attente') {
    item.status = 'en_attente';
    delete item.decidedBy; delete item.decidedAt; delete item.rejectReason;
  }
  save();
  return item;
});

route('DELETE', '/api/items/:id', ({ user, params }) => {
  const item = findItem(params.id, user);
  if (!canApprove(user) && (item.createdBy !== user.id || item.status !== 'en_attente')) throw forbidden();
  db.items = db.items.filter((i) => i !== item);
  save();
  return { ok: true };
});

route('POST', '/api/items/:id/status', ({ user, body, params }) => {
  if (!canApprove(user)) throw forbidden();
  const item = findItem(params.id, user);
  const status = body.status;
  if (!STATUSES.includes(status)) throw bad('Statut invalide.');
  if (status === 'commande' && item.status !== 'approuve') throw bad('Seule une pièce approuvée peut être marquée comme commandée.');
  item.status = status;
  item.decidedBy = user.id;
  item.decidedAt = Date.now();
  if (status === 'refuse') item.rejectReason = str(body.reason, 300); else delete item.rejectReason;
  if (status === 'en_attente') { delete item.decidedBy; delete item.decidedAt; }
  save();
  return item;
});

// --- Départements (admin) ---
route('POST', '/api/departments', ({ user, body }) => {
  if (!isAdmin(user)) throw forbidden();
  const name = str(body.name, 80);
  if (!name) throw bad('Nom requis.');
  if (db.departments.some((d) => d.name.toLowerCase() === name.toLowerCase())) throw bad('Ce département existe déjà.');
  const d = { id: uid(), name };
  db.departments.push(d);
  save();
  return d;
});
route('PUT', '/api/departments/:id', ({ user, body, params }) => {
  if (!isAdmin(user)) throw forbidden();
  const d = db.departments.find((x) => x.id === params.id);
  if (!d) throw notFound('Département introuvable.');
  const name = str(body.name, 80);
  if (!name) throw bad('Nom requis.');
  d.name = name;
  save();
  return d;
});
route('DELETE', '/api/departments/:id', ({ user, params }) => {
  if (!isAdmin(user)) throw forbidden();
  if (db.items.some((i) => i.departmentId === params.id)) throw bad('Ce département contient encore des pièces.');
  if (db.users.some((x) => x.departmentId === params.id)) throw bad('Des utilisateurs sont encore rattachés à ce département.');
  db.departments = db.departments.filter((d) => d.id !== params.id);
  save();
  return { ok: true };
});

// --- Utilisateurs (admin) ---
function userFields(body, existing) {
  const role = body.role ?? existing?.role;
  if (!ROLES.includes(role)) throw bad('Rôle invalide.');
  const departmentId = body.departmentId || null;
  if (departmentId && !db.departments.some((d) => d.id === departmentId)) throw bad('Département invalide.');
  if (role === 'membre' && !departmentId) throw bad('Un membre doit appartenir à un département.');
  const name = str(body.name, 80);
  if (!name) throw bad('Nom requis.');
  return { name, role, departmentId };
}
route('POST', '/api/users', ({ user, body }) => {
  if (!isAdmin(user)) throw forbidden();
  const username = str(body.username, 40);
  const password = String(body.password || '');
  if (!/^[\w.-]{2,40}$/.test(username)) throw bad("Nom d'utilisateur invalide (lettres, chiffres, . _ -).");
  if (password.length < 4) throw bad('Mot de passe trop court (4 caractères minimum).');
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw bad("Ce nom d'utilisateur existe déjà.");
  const created = { id: uid(), username, ...userFields(body), password: hashPassword(password), mustChangePassword: true };
  db.users.push(created);
  save();
  return publicUser(created);
});
route('PUT', '/api/users/:id', ({ user, body, params }) => {
  if (!isAdmin(user)) throw forbidden();
  const target = db.users.find((u) => u.id === params.id);
  if (!target) throw notFound('Utilisateur introuvable.');
  const fields = userFields(body, target);
  if (target.role === 'admin' && fields.role !== 'admin' && db.users.filter((u) => u.role === 'admin').length === 1)
    throw bad('Il doit rester au moins un administrateur.');
  Object.assign(target, fields);
  if (body.password) {
    if (String(body.password).length < 4) throw bad('Mot de passe trop court (4 caractères minimum).');
    target.password = hashPassword(String(body.password));
    target.mustChangePassword = true;
  }
  save();
  return publicUser(target);
});
route('DELETE', '/api/users/:id', ({ user, params }) => {
  if (!isAdmin(user)) throw forbidden();
  const target = db.users.find((u) => u.id === params.id);
  if (!target) throw notFound('Utilisateur introuvable.');
  if (target.id === user.id) throw bad('Vous ne pouvez pas supprimer votre propre compte.');
  db.users = db.users.filter((u) => u !== target);
  save();
  return { ok: true };
});

// ---------- Point d'entrée ----------
// session : { userId } propre à la fenêtre. Retourne { ok, data } ou { ok:false, error }.
function dispatch(session, method, url, body) {
  try {
    load(); // relire le fichier : il peut avoir été modifié par un autre utilisateur
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = url.match(r.re);
      if (!m) continue;
      const user = session.userId && db.users.find((u) => u.id === session.userId);
      if (r.auth && !user) return { ok: false, status: 401, error: 'Non connecté.' };
      return { ok: true, data: r.handler({ user, session, body: body || {}, params: m.groups || {} }) };
    }
    return { ok: false, status: 404, error: 'Route inconnue.' };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, status: 400, error: e.message };
    console.error(e);
    return { ok: false, status: 500, error: 'Erreur interne : ' + e.message };
  }
}

function currentUser(session) {
  load();
  return session.userId ? db.users.find((u) => u.id === session.userId) : null;
}

module.exports = { setDataDir, getDataDir, dbExistsIn, copyDbTo, dispatch, currentUser, isAdmin };
