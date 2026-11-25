const { app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const core = require('./core');

// Une seule instance à la fois
if (!app.requestSingleInstanceLock()) app.quit();

const HAUTEUR_BARRE = 36;
const couleursBarre = () => ({ color: '#0F2548', symbolColor: '#E8DED4', height: HAUTEUR_BARRE });

// Emplacement des données (modifiable par l'administrateur, p. ex. dossier partagé)
const configFile = () => path.join(app.getPath('userData'), 'config.json');
function readConfig() { try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; } }
function writeConfig(cfg) { fs.mkdirSync(path.dirname(configFile()), { recursive: true }); fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2)); }

const session = { userId: null };
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: couleursBarre(),
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#081730' : '#F5F1EC',
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });

  // Zoom au clavier (Ctrl + « + », « - », « 0 »)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const wc = win.webContents;
    const pas = (d) => wc.setZoomFactor(Math.max(0.5, Math.min(3, Math.round((wc.getZoomFactor() + d) * 10) / 10)));
    if (input.key === '+' || input.key === '=') pas(0.1);
    else if (input.key === '-' || input.key === '_') pas(-0.1);
    else if (input.key === '0') wc.setZoomFactor(1);
    else return;
    event.preventDefault();
  });

  // Les liens de produits s'ouvrent dans le navigateur par défaut, jamais dans l'application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  nativeTheme.on('updated', () => { if (!win.isDestroyed()) win.setTitleBarOverlay(couleursBarre()); });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadFile(path.join('src', 'index.html'));
}

ipcMain.handle('api', (event, method, url, body) => core.dispatch(session, method, url, body));

ipcMain.handle('fenetre:action', (event, action) => {
  if (!win || win.isDestroyed()) return;
  if (action === 'recharger') win.webContents.reload();
  else if (action === 'outils' && !app.isPackaged) win.webContents.toggleDevTools();
});

// Administrateur : choisir le dossier qui contient la base de données
ipcMain.handle('donnees:choisir', async () => {
  const user = core.currentUser(session);
  if (!user || !core.isAdmin(user)) return { ok: false, error: 'Droits insuffisants.' };
  const res = await dialog.showOpenDialog(win, {
    title: 'Dossier des données ChinookOrders', properties: ['openDirectory', 'createDirectory'],
    defaultPath: core.getDataDir(),
  });
  if (res.canceled || !res.filePaths[0]) return { ok: true, changed: false };
  const dir = res.filePaths[0];
  if (path.resolve(dir) === path.resolve(core.getDataDir())) return { ok: true, changed: false };
  try {
    if (!core.dbExistsIn(dir)) core.copyDbTo(dir); // nouveau dossier vide : on y copie les données actuelles
    core.setDataDir(dir);
    writeConfig({ dataDir: dir });
    return { ok: true, changed: true, dataDir: dir };
  } catch (e) {
    return { ok: false, error: "Impossible d'utiliser ce dossier : " + e.message };
  }
});
ipcMain.handle('donnees:ouvrir', () => {
  const user = core.currentUser(session);
  if (user && core.isAdmin(user)) shell.openPath(core.getDataDir());
});

app.whenReady().then(() => {
  core.setDataDir(readConfig().dataDir || app.getPath('userData'));
  Menu.setApplicationMenu(null);
  createWindow();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
