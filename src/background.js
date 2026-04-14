/**
 * Service Worker (background) — Manifest V3
 *
 * Responsabilités :
 * - Ouvrir l'éditeur depuis le popup (message 'openEditor')
 * - Menu contextuel "Envoyer dans l'éditeur MMSelect" :
 *   fetcher le PDF de l'onglet actif → stocker en session → ouvrir l'éditeur
 * - Message 'sendPdfToEditor' depuis la popup :
 *   même logique, avec réponse async (succès / erreur)
 */

// ─── Enregistrement du menu contextuel ────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'sendToEditor',
    title: 'Envoyer dans l\'éditeur de bordereau MMShip',
    contexts: ['page'],
  })
})

// ─── Helper partagé : fetch PDF → base64 → session → ouvrir éditeur ──────────
async function fetchAndStorePdf(pdfUrl) {
  const response = await fetch(pdfUrl)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  // Vérifier que le contenu est bien un PDF avant d'aller plus loin
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/pdf')) {
    throw new Error(`Ce contenu n'est pas un PDF (type reçu : ${contentType || 'inconnu'})`)
  }

  const buffer = await response.arrayBuffer()
  const base64 = uint8ArrayToBase64(new Uint8Array(buffer))

  await chrome.storage.session.set({ pendingPdf: { base64, url: pdfUrl } })

  const editorUrl = chrome.runtime.getURL('src/editor/editor.html')
  await new Promise((resolve) => {
    chrome.tabs.create({ url: editorUrl }, (tab) => {
      chrome.windows.update(tab.windowId, { state: 'maximized' }, resolve)
    })
  })
}

// ─── Clic sur le menu contextuel ──────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'sendToEditor') return
  try {
    await fetchAndStorePdf(tab.url)
  } catch (err) {
    console.error('[MMShip] Impossible de récupérer le PDF :', err.message)
  }
})

// ─── Messages depuis la popup ──────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'openEditor') {
    const editorUrl = chrome.runtime.getURL('src/editor/editor.html')
    chrome.tabs.create({ url: editorUrl }, (tab) => {
      chrome.windows.update(tab.windowId, { state: 'maximized' })
    })
    return // pas de réponse async nécessaire
  }

  if (message.action === 'sendPdfToEditor') {
    fetchAndStorePdf(message.url)
      .then(() => {
        // Fermer l'onglet source après un court délai — laisser l'éditeur s'afficher d'abord
        if (message.tabId) setTimeout(() => chrome.tabs.remove(message.tabId), 1500)
        sendResponse({ ok: true })
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }))
    return true // garder le canal ouvert pour la réponse async
  }
})

// ─── Helper : Uint8Array → base64 ────────────────────────────────────────────
// Traite le tableau par blocs pour éviter le stack overflow sur les grands PDF.
function uint8ArrayToBase64(bytes) {
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
