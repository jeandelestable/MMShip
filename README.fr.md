🇬🇧 [English version](README.md)

# MMShip — Shipping label cropper

Extension Chrome (Manifest V3) pour recadrer et imprimer des bordereaux d'expédition PDF directement depuis le navigateur, sans serveur ni service externe. Tout le traitement est local.

**Transporteurs supportés :** DPD · Mondial Relay · DHL

---

## Fonctionnalités

- **Import PDF** depuis le sélecteur de fichier ou via le bouton "Envoyer vers l'éditeur" dans la popup (fonctionne sur n'importe quel onglet HTTP(S) affichant un PDF)
- **Détection automatique du transporteur** par extraction de texte (pdf.js) et correspondance de mots-clés
- **Zone de recadrage visuelle** : pré-dessinée au chargement (coordonnées calibrées par transporteur, ou 10×15 cm centré si inconnu), redéfinissable par cliquer-glisser directement sur le PDF
- **Masque de recadrage** : zone hors sélection assombrie pour visualiser immédiatement ce qui sera imprimé
- **Toggle "Recadrage ON/OFF"** : OFF → impression de la page entière, ON → impression de la zone sélectionnée
- **Zoom** (×0.5 à ×3.0) sur le PDF affiché
- **Impression** via iframe (stratégie primaire) ou canvas (fallback) avec support de la rotation

---

## Architecture

### Stack technique

| Outil | Rôle |
|---|---|
| [Vite](https://vitejs.dev/) + [@crxjs/vite-plugin](https://crxjs.dev/) | Bundler + packaging Chrome Extension |
| [Tailwind CSS v3](https://tailwindcss.com/) | Styles (via PostCSS) |
| [pdf.js (pdfjs-dist v5)](https://mozilla.github.io/pdf.js/) | Rendu PDF + extraction de texte |
| [pdf-lib](https://pdf-lib.js.org/) | Manipulation PDF : setCropBox, rotation |

> **Tailwind v3** (et non v4) : requis par @crxjs/vite-plugin (beta) qui ne supporte pas les imports CSS de Tailwind v4.

### Structure des fichiers

```
manifest.json              # Manifest V3 — permissions, service worker, popup
vite.config.js             # Config Vite + CRXJS
src/
  background.js            # Service Worker : menu contextuel, fetch PDF, messages popup
  popup/
    index.html             # UI de la popup (2 boutons)
    popup.js               # Logique popup : détection onglet PDF, envoi vers éditeur
  editor/
    editor.html            # Interface principale de l'éditeur
    editor.js              # Orchestration : chargement, zoom, recadrage, impression
    pdfRenderer.js         # Chargement pdf.js + rendu canvas
    cropOverlay.js         # Overlay de recadrage : dessin, masque, poignées
    pdfPrinter.js          # Impression : stratégie iframe (primaire) + canvas (fallback)
  config/
    carriers.js            # Définition des transporteurs + détection
  styles/
    main.css               # Entrée Tailwind (@tailwind base/components/utilities)
```

---

## Modules clés

### `src/background.js` — Service Worker

- Enregistre le menu contextuel "Envoyer dans l'éditeur MMShip" (via `onInstalled`)
- Sur clic menu contextuel **ou** message `sendPdfToEditor` depuis la popup :
  1. `fetch(pdfUrl)` — possible sur tous les domaines grâce à `host_permissions: ["<all_urls>"]`
  2. Vérifie que le `Content-Type` est `application/pdf` — lève une erreur sinon (évite de fermer l'onglet source pour une page HTML)
  3. Encode en base64 par blocs de 8192 octets (évite le stack overflow sur les grands PDF)
  4. Stocke dans `chrome.storage.session` (`pendingPdf: { base64, url }`)
  5. Ouvre l'éditeur dans un nouvel onglet maximisé
  6. Ferme l'onglet source après 1,5 s (uniquement en cas de succès, et uniquement si `tabId` fourni)
- Répond `{ ok: true/false }` de façon asynchrone (le listener retourne `true` pour garder le canal ouvert)

### `src/popup/popup.js`

- Au chargement : interroge l'onglet actif (`chrome.tabs.query`), puis fait une requête `HEAD` sur l'URL pour vérifier le `Content-Type` avant d'activer le bouton "Envoyer" :
  - `Content-Type: application/pdf` → bouton activé
  - HTTP 200 + non-PDF → bouton grisé + message *"Aucun PDF détecté dans cet onglet."*
  - Erreur réseau, 401/403, HEAD non supporté → bouton activé de façon optimiste (le SW revalidera avec GET)
  - URL non-HTTP(S) (onglet interne, fichier local) → bouton grisé + message explicatif
- Bouton "Envoyer" : passe en "Chargement…", envoie `{ action: 'sendPdfToEditor', url, tabId }` au SW, attend la réponse async, affiche une erreur inline si échec
- Bouton "Ouvrir l'éditeur" : ouvre l'éditeur vide (fire-and-forget)

### `src/editor/editor.js` — Orchestration principale

**État global :**
```js
pdfPage         // PDFPageProxy pdf.js
pdfPageWidth/Height  // dimensions en points PDF (scale 1)
pdfBytesOrig    // Uint8Array pour pdf-lib
currentScale    // zoom actuel (défaut 1.5)
detectedCarrier // clé carriers.js ou null
cropRect        // { x, y, width, height } en pixels canvas au currentScale
cropEnabled     // toggle recadrage ON/OFF
```

**Au chargement d'un PDF (`loadPdfFromBuffer`) :**
1. Extraction texte + détection transporteur
2. `cropRect = computeInitialCropRect()` → coords transporteur ou zone 10×15 cm centrée
3. Rendu + affichage du masque de recadrage
4. `activateDrawing(cropOverlay, callback)` → dessin direct toujours actif, pas de bouton à activer

**Conversions de coordonnées :**
```
canvas → PDF : x/scale, y = pageHeight − (y+h)/scale
PDF → canvas : x*scale, y = (pageHeight − y_pdf − h_pdf)*scale
```

Le système de coordonnées PDF a l'origine en bas-gauche (y croît vers le haut), à l'inverse du canvas.

### `src/editor/cropOverlay.js`

- `activateDrawing(canvas, onCropDefined)` : attache les listeners mousedown/move/up, curseur crosshair
- `deactivateDrawing(canvas)` : supprime les listeners (handlers stockés dans un objet module-level pour le removeEventListener)
- `drawRect(canvas, rect)` :
  1. Remplit tout le canvas en `rgba(0,0,0,0.40)` (masque sombre)
  2. `clearRect(rect)` → découpe transparente sur la zone sélectionnée (laisse voir le PDF en dessous)
  3. Dessine la bordure pointillée bleue + poignées carrées aux 4 coins (centrées sur les angles)

### `src/editor/pdfPrinter.js`

**Stratégie primaire (`printCropped`) :**
- pdf-lib : `page.setCropBox(x, y, w, h)` + `page.setRotation(degrees(r))`
- Génère un blob PDF, l'injecte dans un `<iframe>`, appelle `iframe.contentWindow.print()`
- Timeout 3s : si l'iframe ne charge pas (CSP bloquerait le blob), lève une erreur → fallback

**Stratégie fallback (`printViaCanvas`) :**
- Rendu hors-écran à scale 3.0 (qualité impression)
- Extraction de la zone crop via `drawImage`
- Rotation via `applyRotationToCanvas` (translate + rotate sur contexte 2D)
- Affiche le canvas, appelle `window.print()`, masque le canvas

### `src/config/carriers.js`

```js
export const carriers = {
  DPD: {
    keywords: ['DPD', 'dpd france', 'dpdgroup', 'chronopost'],
    cropCoordinates: { x: 0, y: 421, width: 297, height: 421 },
    // A4 portrait (595×842pt), quart haut-gauche
  },
  MondialRelay: {
    keywords: ['mondial relay', 'mondialrelay', ...],
    cropCoordinates: { x: 85, y: 34, width: 425, height: 283 },
    rotation: -90,
    // A4 portrait, moitié basse, rotation 90° antihoraire à l'impression
  },
  DHL: {
    keywords: ['dhl', 'deutsche post', ...],
    cropCoordinates: { x: 85, y: 28, width: 283, height: 539 },
    // A4 paysage (842×595pt), moitié gauche
  },
}
```

**Détection :** `rawText.toLowerCase().replace(/\s+/g, ' ')` puis `includes(keyword)` — la normalisation des espaces est indispensable car pdf.js extrait parfois le texte avec des espaces multiples (ex: `"MONDIAL  RELAY"`).

**Calibration :** pour ajouter un transporteur, charger un PDF en mode éditeur, dessiner la zone manuellement, et lire les coordonnées affichées ("Zone de recadrage — x: …").

---

## Build & Installation

### Pré-requis

- Node.js ≥ 18 (testé avec nvm)
- npm

### Développement

```bash
npm install
npm run build        # génère dist/
```

En développement avec hot-reload (limité pour les extensions) :
```bash
npm run dev
```

### Installer l'extension dans Chrome

1. `npm run build` → dossier `dist/` généré
2. Chrome → `chrome://extensions/` → activer "Mode développeur"
3. "Charger l'extension non empaquetée" → sélectionner le dossier `dist/`
4. Après chaque `npm run build` : cliquer "Recharger" sur la carte de l'extension
5. ⚠️ Après modification de `manifest.json` : désactiver/réactiver l'extension (ou "Supprimer" + recharger)

---

## Décisions techniques et pièges connus

### @crxjs/vite-plugin et `rollupOptions.input`
CRXJS traite les fichiers HTML référencés dans `web_accessible_resources` comme des ressources statiques (pas des entry points Vite). `editor.html` doit être explicitement déclaré dans `rollupOptions.input` pour que ses imports `<script type="module">` soient bundlés correctement.

### pdf.js et Vite (`optimizeDeps.exclude`)
pdf.js embarque son propre worker (`pdf.worker.min.mjs`). Vite ne doit pas le pré-bundler. Solution : `optimizeDeps: { exclude: ['pdfjs-dist'] }`. Le worker est importé avec le suffix `?url` pour obtenir son chemin final dans le bundle.

### CORS et fetch PDF depuis un domaine externe
La page éditeur (`chrome-extension://...`) ne peut pas fetcher un PDF sur `https://domaine-tiers.com` directement (CORS). Le Service Worker peut le faire car `host_permissions: ["<all_urls>"]` désactive la restriction CORS côté SW. Flux : SW fetche → base64 → `chrome.storage.session` → éditeur lit au démarrage.

### Stockage de grands fichiers binaires
`String.fromCharCode(...bytes)` sur un grand tableau provoque un stack overflow (spread d'un Uint8Array de plusieurs MB). Solution : découpage en blocs de 8192 octets avant `btoa()`.

### Système de coordonnées PDF
- Origine (0,0) = **coin bas-gauche** de la page
- Y croît **vers le haut** (inverse du canvas HTML)
- Unité : **points typographiques** (1pt = 1/72 pouce ≈ 0.353 mm, 1 cm ≈ 28.346 pt)
- Une page A4 portrait = 595 × 842 pt

### Rotation Mondial Relay
Le bordereau Mondial Relay est en orientation paysage dans un PDF portrait. L'impression nécessite une rotation de −90° (90° antihoraire). Stratégie iframe : `page.setRotation(degrees(-90))` via pdf-lib. Stratégie canvas : `ctx.translate(0, dest.height); ctx.rotate(-Math.PI / 2)`.

### Validation PDF en deux étapes (popup + SW)
La popup fait un `HEAD` pour désactiver le bouton "Envoyer" avant même le clic (UX). Le SW refait un `GET` complet et revalide le `Content-Type` pour garantir qu'un faux positif du `HEAD` ne ferme pas l'onglet source. Cette double validation couvre : serveurs qui ne supportent pas `HEAD` (popup échoue → optimiste), redirections, et Content-Type mal renseigné.

### Fermeture de l'onglet source
Le `tabId` de l'onglet source est transmis par la popup dans le message `sendPdfToEditor`. Le SW appelle `chrome.tabs.remove(tabId)` avec un délai de 1,5 s **uniquement en cas de succès**, après que l'éditeur soit ouvert. En cas d'échec, l'onglet source n'est jamais touché.
