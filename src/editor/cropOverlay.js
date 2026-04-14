/**
 * Module de recadrage.
 * Gère le canvas overlay positionné au-dessus du canvas PDF.
 *
 * Interactions supportées :
 *   - Dessin d'une nouvelle zone    → cliquer-glisser dans une zone vide
 *   - Déplacement de la zone        → cliquer-glisser à l'intérieur
 *   - Redimensionnement             → cliquer-glisser sur une poignée (coin ou milieu de côté)
 *
 * Les événements de drag sont capturés au niveau document pour éviter de perdre
 * le suivi si la souris sort du canvas.
 */

// ─── État interne ──────────────────────────────────────────────────────────────
let currentRect  = null   // { x, y, width, height } en pixels canvas
let mode         = 'idle' // 'idle' | 'drawing' | 'moving' | 'resizing'
let activeHandle = null   // poignée en cours de drag ('tl', 'mr', …)
let dragOrigin   = null   // { x, y } au mousedown (coordonnées canvas)
let rectAtDrag   = null   // snapshot du rect au mousedown

const HANDLE_HIT = 10    // rayon de détection (px)
const HANDLE_VIS = 8     // taille visuelle des poignées (px)

const handlers = {}      // références des listeners pour removeEventListener propre

// ─── Positions des 8 poignées ─────────────────────────────────────────────────
function handlePositions(r) {
  const cx = r.x + r.width  / 2
  const cy = r.y + r.height / 2
  return {
    tl: { x: r.x,            y: r.y             },
    tm: { x: cx,              y: r.y             },
    tr: { x: r.x + r.width,  y: r.y             },
    ml: { x: r.x,            y: cy              },
    mr: { x: r.x + r.width,  y: cy              },
    bl: { x: r.x,            y: r.y + r.height  },
    bm: { x: cx,              y: r.y + r.height  },
    br: { x: r.x + r.width,  y: r.y + r.height  },
  }
}

// ─── Hit test ─────────────────────────────────────────────────────────────────
function hitTest(r, x, y) {
  if (!r) return 'draw'
  for (const [name, pos] of Object.entries(handlePositions(r))) {
    if (Math.abs(x - pos.x) <= HANDLE_HIT && Math.abs(y - pos.y) <= HANDLE_HIT) return name
  }
  if (x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height) return 'move'
  return 'draw'
}

// ─── Curseurs contextuels ─────────────────────────────────────────────────────
const CURSORS = {
  tl: 'nw-resize', tm: 'ns-resize', tr: 'ne-resize',
  ml: 'ew-resize',                   mr: 'ew-resize',
  bl: 'sw-resize', bm: 'ns-resize', br: 'se-resize',
  move: 'move', draw: 'crosshair',
}

// ─── Calcul du nouveau rect après resize ──────────────────────────────────────
function applyResize(handle, orig, dx, dy) {
  let { x, y, width, height } = { ...orig }
  const MIN = 10

  // Côté gauche : x bouge, width compense
  if ('tl ml bl'.includes(handle)) { x += dx; width  -= dx }
  // Côté droit  : width seul
  if ('tr mr br'.includes(handle)) { width  += dx }
  // Côté haut   : y bouge, height compense
  if ('tl tm tr'.includes(handle)) { y += dy; height -= dy }
  // Côté bas    : height seul
  if ('bl bm br'.includes(handle)) { height += dy }

  // Éviter l'inversion (taille minimale)
  if (width  < MIN) { if ('tl ml bl'.includes(handle)) x -= (MIN - width);  width  = MIN }
  if (height < MIN) { if ('tl tm tr'.includes(handle)) y -= (MIN - height); height = MIN }

  return { x, y, width, height }
}

// ─── Conversion event document → coordonnées canvas ──────────────────────────
function toCanvas(canvas, e) {
  const r = canvas.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

// ─── Dessin ────────────────────────────────────────────────────────────────────
export function drawRect(overlayCanvas, rect) {
  const ctx = overlayCanvas.getContext('2d')
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)

  // Masque sombre hors sélection
  ctx.fillStyle = 'rgba(0,0,0,0.40)'
  ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height)

  // Découpe transparente sur la zone sélectionnée (laisse voir le PDF)
  ctx.clearRect(rect.x, rect.y, rect.width, rect.height)

  // Bordure pointillée bleue
  ctx.strokeStyle = '#3B82F6'
  ctx.lineWidth   = 1.5
  ctx.setLineDash([6, 3])
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)
  ctx.setLineDash([])

  // 8 poignées (bleues, bord blanc)
  const hv = HANDLE_VIS
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth   = 1.5
  for (const pos of Object.values(handlePositions(rect))) {
    ctx.fillStyle = '#3B82F6'
    ctx.fillRect  (pos.x - hv / 2,       pos.y - hv / 2,       hv,     hv    )
    ctx.strokeRect(pos.x - hv / 2 + 0.5, pos.y - hv / 2 + 0.5, hv - 1, hv - 1)
  }
}

export function clearOverlay(overlayCanvas) {
  overlayCanvas.getContext('2d').clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
}

export function getCurrentRect() { return currentRect }

/** Synchronise l'état interne quand le rect est modifié de l'extérieur (zoom, toggle…). */
export function setCurrentRect(rect) {
  currentRect = rect ? { ...rect } : null
}

// ─── Activation ───────────────────────────────────────────────────────────────
/**
 * @param {HTMLCanvasElement} overlayCanvas
 * @param {{ x, y, width, height }|null} initialRect - zone pré-existante à restaurer
 * @param {function} onCropDefined - callback appelé quand la zone est définie/modifiée
 */
export function activateDrawing(overlayCanvas, initialRect, onCropDefined) {
  currentRect = initialRect ? { ...initialRect } : null
  overlayCanvas.style.pointerEvents = 'auto'

  // ── Handlers document (actifs uniquement pendant un drag) ──────────────────
  handlers.docMousemove = (e) => {
    if (mode === 'idle') return
    const { x, y } = toCanvas(overlayCanvas, e)
    const dx = x - dragOrigin.x
    const dy = y - dragOrigin.y

    if (mode === 'drawing') {
      drawRect(overlayCanvas, normalizeRect(dragOrigin.x, dragOrigin.y, x, y))
      return
    }
    if (mode === 'moving' && rectAtDrag) {
      const W = overlayCanvas.width, H = overlayCanvas.height
      currentRect = {
        x:      Math.max(0, Math.min(rectAtDrag.x + dx, W - rectAtDrag.width)),
        y:      Math.max(0, Math.min(rectAtDrag.y + dy, H - rectAtDrag.height)),
        width:  rectAtDrag.width,
        height: rectAtDrag.height,
      }
      drawRect(overlayCanvas, currentRect)
    }
    if (mode === 'resizing' && rectAtDrag) {
      currentRect = applyResize(activeHandle, rectAtDrag, dx, dy)
      drawRect(overlayCanvas, currentRect)
    }
  }

  handlers.docMouseup = (e) => {
    if (mode === 'idle') return
    const { x, y } = toCanvas(overlayCanvas, e)

    if (mode === 'drawing') {
      const r = normalizeRect(dragOrigin.x, dragOrigin.y, x, y)
      if (r.width >= 5 && r.height >= 5) {
        currentRect = r
        drawRect(overlayCanvas, r)
        onCropDefined(r)
      } else {
        clearOverlay(overlayCanvas)
      }
    } else if (currentRect) {
      onCropDefined(currentRect)
    }

    mode         = 'idle'
    dragOrigin   = null
    rectAtDrag   = null
    activeHandle = null
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', handlers.docMousemove)
    document.removeEventListener('mouseup',   handlers.docMouseup)

    overlayCanvas.style.cursor = CURSORS[hitTest(currentRect, x, y)] ?? 'crosshair'
  }

  // ── Handlers canvas ────────────────────────────────────────────────────────
  handlers.mousemove = (e) => {
    if (mode !== 'idle') return
    overlayCanvas.style.cursor = CURSORS[hitTest(currentRect, e.offsetX, e.offsetY)] ?? 'crosshair'
  }

  handlers.mousedown = (e) => {
    e.preventDefault()
    const hit = hitTest(currentRect, e.offsetX, e.offsetY)
    dragOrigin = { x: e.offsetX, y: e.offsetY }
    rectAtDrag = currentRect ? { ...currentRect } : null

    if (hit === 'draw') {
      mode = 'drawing'
      currentRect = null
      clearOverlay(overlayCanvas)
    } else if (hit === 'move') {
      mode = 'moving'
    } else {
      mode         = 'resizing'
      activeHandle = hit
    }

    overlayCanvas.style.cursor    = CURSORS[hit] ?? 'crosshair'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handlers.docMousemove)
    document.addEventListener('mouseup',   handlers.docMouseup)
  }

  overlayCanvas.addEventListener('mousemove', handlers.mousemove)
  overlayCanvas.addEventListener('mousedown', handlers.mousedown)
}

// ─── Désactivation ────────────────────────────────────────────────────────────
export function deactivateDrawing(overlayCanvas) {
  overlayCanvas.style.cursor        = 'default'
  overlayCanvas.style.pointerEvents = 'none'
  mode                              = 'idle'
  document.body.style.userSelect    = ''

  overlayCanvas.removeEventListener('mousemove', handlers.mousemove)
  overlayCanvas.removeEventListener('mousedown', handlers.mousedown)
  document.removeEventListener('mousemove', handlers.docMousemove)
  document.removeEventListener('mouseup',   handlers.docMouseup)
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function normalizeRect(x1, y1, x2, y2) {
  return {
    x:      Math.min(x1, x2),
    y:      Math.min(y1, y2),
    width:  Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}
