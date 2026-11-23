const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pont', {
  requete: (method, url, body) => ipcRenderer.invoke('api', method, url, body),
  actionFenetre: (action) => ipcRenderer.invoke('fenetre:action', action),
  choisirDossierDonnees: () => ipcRenderer.invoke('donnees:choisir'),
  ouvrirDossierDonnees: () => ipcRenderer.invoke('donnees:ouvrir'),
});
