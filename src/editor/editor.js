import { loadPdf, renderPage } from './pdfRenderer.js'
import {
  activateDrawing,
  deactivateDrawing,
  drawRect,
  clearOverlay,
} from './cropOverlay.js'
import { printCropped, printViaCanvas } from './pdfPrinter.js'
import { carriers, detectCarrier } from '../config/carriers.js'

// ─── Refs DOM ─────────────────────────────────────────────────────────────────
const cropToggle      = document.getElementById('cropToggle')
const cropToggleLabel = document.getElementById('cropToggleLabel')
const zoomControls    = document.getElementById('zoomControls')
const pdfInput        = document.getElementById('pdfInput')
const carrierNameEl   = document.getElementById('carrierName')
const carrierDot      = document.getElementById('carrierDot')
const placeholder     = document.getElementById('placeholder')
const pdfViewer       = document.getElementById('pdfViewer')
const pdfCanvas       = document.getElementById('pdfCanvas')
const cropOverlay     = document.getElementById('cropOverlay')
const printFrame      = document.getElementById('printFrame')
const printCanvas     = document.getElementById('printCanvas')
const printBtn        = document.getElementById('printBtn')
const zoomInBtn       = document.getElementById('zoomIn')
const zoomOutBtn      = document.getElementById('zoomOut')
const coordsDisplay   = document.getElementById('coordsDisplay')
const coordsText      = document.getElementById('coordsText')

// ─── État ─────────────────────────────────────────────────────────────────────
let pdfPage         = null   // PDFPageProxy pdf.js
let pdfPageWidth    = 0      // largeur page en points PDF (scale 1)
let pdfPageHeight   = 0      // hauteur page en points PDF (scale 1)
let pdfBytesOrig    = null   // Uint8Array original pour pdf-lib
let currentScale    = 1.5
let detectedCarrier = null   // clé dans carriers (ex: 'DPD') ou null
let cropRect        = null   // { x, y, width, height } en pixels canvas au currentScale
let cropEnabled     = true   // toggle recadrage ON/OFF

// ─── Chargement d'un PDF depuis un ArrayBuffer ────────────────────────────────
async function loadPdfFromBuffer(arrayBuffer) {
  printBtn.disabled = true
  setCarrier(null)

  try {
    // Conserver les octets originaux pour pdf-lib (avant que pdf.js les consomme)
    pdfBytesOrig = new Uint8Array(arrayBuffer)

    // Charger via pdf.js avec une copie de l'ArrayBuffer
    const result = await loadPdf(arrayBuffer.slice())
    pdfPage = result.page
    pdfPageWidth = result.pageWidth
    pdfPageHeight = result.pageHeight

    // Détection automatique du transporteur
    detectedCarrier = detectCarrier(result.textContent)
    setCarrier(detectedCarrier)

    // Afficher la visionneuse
    placeholder.classList.add('hidden')
    pdfViewer.classList.remove('hidden')

    // Réinitialiser le toggle recadrage à ON
    cropEnabled = true
    cropToggle.checked = true
    cropToggleLabel.textContent = 'ON'
    cropToggleLabel.className = 'text-sm font-semibold text-emerald-600'

    // Pré-initialiser la zone de recadrage (transporteur ou 10×15cm centré)
    clearOverlay(cropOverlay)
    cropRect = computeInitialCropRect()

    await renderAndSyncOverlay()
    showCropCoords(cropRect)

    // Afficher les boutons de zoom
    zoomControls.classList.remove('hidden')
    zoomControls.classList.add('flex')

    // Activer le dessin direct — toujours actif, pas besoin de bouton
    deactivateDrawing(cropOverlay) // nettoyer d'anciens listeners si re-chargement
    activateDrawing(cropOverlay, (rect) => {
      cropRect = rect
      showCropCoords(rect)
    })
  } catch (err) {
    console.error('[MMShip] Erreur lors du chargement du PDF :', err)
    alert(`Erreur lors du chargement du PDF : ${err.message}`)
  } finally {
    printBtn.disabled = false
  }
}

// ─── Import PDF depuis le sélecteur de fichier ────────────────────────────────
pdfInput.addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file) return
  await loadPdfFromBuffer(await file.arrayBuffer())
  pdfInput.value = '' // permet de ré-importer le même fichier
})

// ─── Render + sync overlay ────────────────────────────────────────────────────
async function renderAndSyncOverlay() {
  if (!pdfPage) return
  await renderPage(pdfPage, pdfCanvas, currentScale)

  // Synchroniser les dimensions de l'overlay avec le canvas PDF
  cropOverlay.width = pdfCanvas.width
  cropOverlay.height = pdfCanvas.height

  // Redessiner le rectangle de crop s'il existe
  if (cropRect) drawRect(cropOverlay, cropRect)
}

// ─── Toggle Recadrage ON / OFF ────────────────────────────────────────────────
cropToggle.addEventListener('change', () => {
  if (!pdfPage) return // aucun PDF chargé, ignorer

  cropEnabled = cropToggle.checked

  if (cropEnabled) {
    // Rétablir la zone initiale (transporteur ou 10×15cm centré)
    cropToggleLabel.textContent = 'ON'
    cropToggleLabel.className = 'text-sm font-semibold text-emerald-600'
    cropRect = computeInitialCropRect()
    cropOverlay.style.pointerEvents = 'auto'
    renderAndSyncOverlay().then(() => showCropCoords(cropRect))
  } else {
    // Effacer la zone — impression page entière
    cropToggleLabel.textContent = 'OFF'
    cropToggleLabel.className = 'text-sm font-semibold text-gray-400'
    cropRect = null
    clearOverlay(cropOverlay)
    cropOverlay.style.pointerEvents = 'none'
    hideCropCoords()
  }
})

// ─── Zoom ─────────────────────────────────────────────────────────────────────
zoomInBtn.addEventListener('click', async () => {
  if (currentScale >= 3.0) return
  applyZoom(currentScale + 0.25)
})

zoomOutBtn.addEventListener('click', async () => {
  if (currentScale <= 0.5) return
  applyZoom(Math.max(0.5, currentScale - 0.25))
})

async function applyZoom(newScale) {
  const factor = newScale / currentScale
  currentScale = newScale

  // Rescaler le cropRect pour qu'il reste aligné avec le contenu
  if (cropRect) {
    cropRect = {
      x: cropRect.x * factor,
      y: cropRect.y * factor,
      width: cropRect.width * factor,
      height: cropRect.height * factor,
    }
  }

  await renderAndSyncOverlay()
}

// ─── Impression ───────────────────────────────────────────────────────────────
printBtn.addEventListener('click', async () => {
  if (!pdfPage || !pdfBytesOrig) {
    alert('Aucun PDF chargé.')
    return
  }

  let cropCoordsPdf
  let printRotation = 0

  if (!cropEnabled) {
    // Impression page entière
    cropCoordsPdf = { x: 0, y: 0, width: pdfPageWidth, height: pdfPageHeight }
  } else {
    // Utiliser la zone de recadrage active
    cropCoordsPdf = canvasToPdfCoords(cropRect, currentScale, pdfPageHeight)
    // Appliquer la rotation du transporteur si détecté
    if (detectedCarrier) {
      printRotation = carriers[detectedCarrier].rotation ?? 0
    }
  }

  printBtn.disabled = true
  printBtn.textContent = 'Impression…'

  try {
    await printCropped(pdfBytesOrig.slice(), cropCoordsPdf, printFrame, printRotation)
  } catch (err) {
    console.warn('[MMShip] Impression via iframe échouée, fallback canvas :', err.message)
    try {
      await printViaCanvas(pdfPage, cropCoordsPdf, pdfPageHeight, printCanvas, printRotation)
    } catch (err2) {
      console.error('[MMShip] Impression fallback échouée :', err2)
      alert('Impossible d\'imprimer. Vérifiez la console pour les détails.')
    }
  } finally {
    printBtn.disabled = false
    printBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a1 1 0 001 1h8a1 1 0 001-1v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a1 1 0 00-1-1H6a1 1 0 00-1 1zm2 0h6v3H7V4zm-1 9v-1a1 1 0 011-1h6a1 1 0 011 1v1h1a1 1 0 000-2H4a1 1 0 000 2h2zm7 2H7v-2h6v2z" clip-rule="evenodd" />
      </svg>
      Imprimer`
  }
})

// ─── Badge transporteur ───────────────────────────────────────────────────────
function setCarrier(name) {
  if (name) {
    carrierNameEl.textContent = name
    carrierDot.classList.remove('bg-gray-300')
    carrierDot.classList.add('bg-green-400')
  } else {
    carrierNameEl.textContent = 'Aucun'
    carrierDot.classList.remove('bg-green-400')
    carrierDot.classList.add('bg-gray-300')
  }
}

// ─── Conversion coordonnées canvas → points PDF ───────────────────────────────
function canvasToPdfCoords(rect, scale, pageHeight) {
  return {
    x: rect.x / scale,
    y: pageHeight - (rect.y + rect.height) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  }
}

// ─── Conversion coordonnées PDF → pixels canvas ───────────────────────────────
function pdfToCanvasCoords(pdfRect, scale, pageHeight) {
  return {
    x: pdfRect.x * scale,
    y: (pageHeight - pdfRect.y - pdfRect.height) * scale,
    width: pdfRect.width * scale,
    height: pdfRect.height * scale,
  }
}

// ─── Zone de recadrage initiale au chargement d'un PDF ───────────────────────
// Si le transporteur est détecté : ses coordonnées. Sinon : 10×15cm centré.
function computeInitialCropRect() {
  if (detectedCarrier) {
    return pdfToCanvasCoords(carriers[detectedCarrier].cropCoordinates, currentScale, pdfPageHeight)
  }
  const W = Math.round(10 * 28.346) // 283 pt ≈ 10 cm
  const H = Math.round(15 * 28.346) // 425 pt ≈ 15 cm
  return pdfToCanvasCoords(
    {
      x: (pdfPageWidth - W) / 2,
      y: (pdfPageHeight - H) / 2,
      width: W,
      height: H,
    },
    currentScale,
    pdfPageHeight,
  )
}

// ─── Affichage des coordonnées PDF de la zone sélectionnée ───────────────────
function showCropCoords(canvasRect) {
  const c = canvasToPdfCoords(canvasRect, currentScale, pdfPageHeight)
  coordsText.textContent =
    `x: ${Math.round(c.x)}, y: ${Math.round(c.y)}, w: ${Math.round(c.width)}, h: ${Math.round(c.height)}`
  coordsDisplay.classList.remove('hidden')
}

function hideCropCoords() {
  coordsDisplay.classList.add('hidden')
}

// ─── Chargement du PDF depuis le menu contextuel / popup ─────────────────────
async function checkPendingPdf() {
  const result = await chrome.storage.session.get('pendingPdf')
  if (!result.pendingPdf) return

  await chrome.storage.session.remove('pendingPdf') // libérer immédiatement

  const { base64 } = result.pendingPdf
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  await loadPdfFromBuffer(bytes.buffer)
}

checkPendingPdf()
