# ChinookOrders

Application de bureau (Windows) du club Chinook (ÉTS) pour **lister les pièces à commander par département**, les faire **approuver** par un responsable, puis suivre leur état. Elle ne commande rien : les commandes se font ensuite sur le site de chaque fournisseur. Les totaux sont **hors livraison**.

## Fonctionnalités

- Une liste par département : pièce, lien du produit, prix unitaire, quantité, note, avec total par département et total global.
- Flux : En attente → Approuvé (ou Refusé) → Commandé. Modifier une pièce la remet « En attente ».
- « Grouper par site » regroupe les pièces par fournisseur pour commander site par site ; le lien s'ouvre dans le navigateur.
- Rôles : **Membre** (son département), **Approbateur** (voit tout, approuve/refuse, marque « commandé »), **Administrateur** (en plus : utilisateurs, départements, emplacement des données).
- Thème clair/sombre selon Windows, fonctionne hors ligne.

## Technologies

Electron, JavaScript. Aucune dépendance native (pas de `electron-rebuild`) : les données sont un fichier JSON.

## Démarrer (développement)

```bash
npm install
node node_modules/electron/install.js   # seulement si Electron n'a pas téléchargé son binaire
npm start
```

Premier accès : `admin` / `admin` (changement de mot de passe demandé).

## Créer l'installateur Windows

```bash
npm run build
```
L'installateur est écrit dans `release/`.

## Où sont les données

Dans `chinook-orders.json`, par défaut dans `%APPDATA%\chinookorders`. Ce fichier n'est pas dans le dépôt : **pensez à le sauvegarder**.

Pour partager les listes entre plusieurs postes : administration → « Emplacement des données » → « Changer… », et choisir un dossier partagé (réseau, OneDrive). Faire de même sur chaque poste. Le fichier est relu à chaque action ; le bouton « Actualiser » recharge les changements des autres. Évitez que deux personnes enregistrent exactement au même moment.
