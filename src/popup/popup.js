const sendBtn  = document.getElementById('sendPdf')
const statusEl = document.getElementById('sendError') // réutilisé pour hint + erreur
const openBtn  = document.getElementById('openEditor')

// ─── Ouvrir l'éditeur vide ────────────────────────────────────────────────
openBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'openEditor' })
  window.close()
})

// ─── Vérifier si l'onglet actif contient un PDF ───────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
  const url = tab?.url ?? ''

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    setStatus('Ouvrez un PDF dans un onglet pour l\'envoyer.', false)
    return
  }

  try {
    const res = await fetch(url, { method: 'HEAD' })
    const contentType = res.headers.get('content-type') ?? ''

    if (res.ok && !contentType.includes('application/pdf')) {
      // Réponse claire : ce n'est pas un PDF
      setStatus('Aucun PDF détecté dans cet onglet.', false)
    } else {
      // PDF confirmé, ou réponse ambiguë (auth requise, erreur serveur) → optimiste
      sendBtn.disabled = false
    }
  } catch {
    // Erreur réseau ou HEAD non supporté → activer par optimisme
    sendBtn.disabled = false
  }
})

// ─── Envoyer le PDF de l'onglet actif vers l'éditeur ─────────────────────
sendBtn.addEventListener('click', () => {
  clearStatus()
  sendBtn.disabled = true
  sendBtn.textContent = 'Chargement\u2026'

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    chrome.runtime.sendMessage(
      { action: 'sendPdfToEditor', url: tab.url, tabId: tab.id },
      (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          sendBtn.disabled = false
          sendBtn.textContent = 'Envoyer vers l\'éditeur de bordereau'
          setStatus(response?.error ?? 'Impossible de récupérer le PDF.', true)
        } else {
          window.close()
        }
      },
    )
  })
})

// ─── Helpers affichage statut ─────────────────────────────────────────────
function setStatus(text, isError) {
  statusEl.textContent = text
  statusEl.classList.toggle('text-red-600', isError)
  statusEl.classList.toggle('text-gray-400', !isError)
  statusEl.classList.remove('hidden')
}

function clearStatus() {
  statusEl.classList.add('hidden')
}
