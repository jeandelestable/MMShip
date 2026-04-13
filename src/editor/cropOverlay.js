/**
 * Module de recadrage manuel.
 * Gère le canvas overlay positionné au-dessus du canvas PDF pour permettre
 * à l'utilisateur de dessiner une zone de recadrage par cliquer-glisser.
 */

let isDrawing = false
let startX = 0
let startY = 0
let currentRect = null // { x, y, width, height } en pixels canvas

// Références aux handlers pour pouvoir les supprimer proprement
const handlers = {}

/**
 * Active le mode dessin sur l'overlay canvas.
 * Appelle onCropDefined(rect) quand l'utilisateur relâche la souris.
 *
 * @param {HTMLCanvasElement} overlayCanvas
 * @param {function({x: number, y: number, width: number, height: number}): void} onCropDefined
 */
export function activateDrawing(overlayCanvas, onCropDefined) {
  overlayCanvas.style.cursor = 'crosshair'
  overlayCanvas.style.pointerEvents = 'auto'

  handlers.mousedown = (e) => {
    isDrawing = true
    startX = e.offsetX
    startY = e.offsetY
    currentRect = null
    clearOverlay(overlayCanvas)
  }

  handlers.mousemove = (e) => {
    if (!isDrawing) return
    const rect = normalizeRect(startX, startY, e.offsetX, e.offsetY)
    drawRect(overlayCanvas, rect)
  }

  handlers.mouseup = (e) => {
    if (!isDrawing) return
    isDrawing = false
    const rect = normalizeRect(startX, startY, e.offsetX, e.offsetY)

    // Zone trop petite → ignorer
    if (rect.width < 5 || rect.height < 5) {
      clearOverlay(overlayCanvas)
      return
    }

    currentRect = rect
    drawRect(overlayCanvas, rect)
    onCropDefined(rect)
  }

  handlers.mouseleave = () => {
    // Si l'utilisateur sort du canvas en dessinant, on finalise
    if (isDrawing) {
      isDrawing = false
      if (currentRect && currentRect.width >= 5 && currentRect.height >= 5) {
        onCropDefined(currentRect)
      }
    }
  }

  overlayCanvas.addEventListener('mousedown', handlers.mousedown)
  overlayCanvas.addEventListener('mousemove', handlers.mousemove)
  overlayCanvas.addEventListener('mouseup', handlers.mouseup)
  overlayCanvas.addEventListener('mouseleave', handlers.mouseleave)
}

/**
 * Désactive le mode dessin et remet le curseur par défaut.
 *
 * @param {HTMLCanvasElement} overlayCanvas
 */
export function deactivateDrawing(overlayCanvas) {
  overlayCanvas.style.cursor = 'default'
  overlayCanvas.style.pointerEvents = 'none'
  isDrawing = false

  overlayCanvas.removeEventListener('mousedown', handlers.mousedown)
  overlayCanvas.removeEventListener('mousemove', handlers.mousemove)
  overlayCanvas.removeEventListener('mouseup', handlers.mouseup)
  overlayCanvas.removeEventListener('mouseleave', handlers.mouseleave)
}

/**
 * Dessine un rectangle de sélection sur l'overlay canvas.
 *
 * @param {HTMLCanvasElement} overlayCanvas
 * @param {{ x: number, y: number, width: number, height: number }} rect
 */
export function drawRect(overlayCanvas, rect) {
  const ctx = overlayCanvas.getContext('2d')
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)

  // Masque sombre sur tout le canvas
  ctx.fillStyle = 'rgba(0, 0, 0, 0.40)'
  ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height)

  // Découpe transparente sur la zone sélectionnée (laisse voir le PDF en dessous)
  ctx.clearRect(rect.x, rect.y, rect.width, rect.height)

  // Bordure pointillée bleue
  ctx.strokeStyle = '#3B82F6'
  ctx.lineWidth = 1.5
  ctx.setLineDash([6, 3])
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)
  ctx.setLineDash([])

  // Poignées aux coins (centrées sur les angles, chevauchant le bord)
  const hs = 5 // demi-taille → poignée de 10×10px
  ctx.fillStyle = '#3B82F6'
  const corners = [
    [rect.x - hs, rect.y - hs],
    [rect.x + rect.width - hs, rect.y - hs],
    [rect.x - hs, rect.y + rect.height - hs],
    [rect.x + rect.width - hs, rect.y + rect.height - hs],
  ]
  corners.forEach(([cx, cy]) => ctx.fillRect(cx, cy, hs * 2, hs * 2))
}

/**
 * Efface l'overlay canvas.
 *
 * @param {HTMLCanvasElement} overlayCanvas
 */
export function clearOverlay(overlayCanvas) {
  const ctx = overlayCanvas.getContext('2d')
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
}

/**
 * Retourne le dernier rectangle dessiné (en pixels canvas).
 *
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function getCurrentRect() {
  return currentRect
}

// ─── Helpers internes ─────────────────────────────────────────────────────────

/**
 * Normalise un rectangle pour que x/y soient toujours le coin haut-gauche,
 * quelle que soit la direction du drag.
 */
function normalizeRect(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}
