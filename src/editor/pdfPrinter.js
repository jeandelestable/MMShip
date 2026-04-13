import { PDFDocument, degrees } from 'pdf-lib'
import { renderPage } from './pdfRenderer.js'

/**
 * Stratégie primaire : génère un PDF recadré (+ pivoté si besoin) avec pdf-lib
 * et l'imprime via un iframe caché.
 * Si l'iframe ne se charge pas dans les 3s, lève une erreur → fallback canvas.
 *
 * @param {Uint8Array} pdfBytes
 * @param {{ x: number, y: number, width: number, height: number }} cropCoordsPdf
 * @param {HTMLIFrameElement} printFrame
 * @param {number} [rotation=0] - rotation en degrés (ex: -90 pour Mondial Relay)
 * @returns {Promise<void>}
 */
export async function printCropped(pdfBytes, cropCoordsPdf, printFrame, rotation = 0) {
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const page = pdfDoc.getPage(0)

  page.setCropBox(
    cropCoordsPdf.x,
    cropCoordsPdf.y,
    cropCoordsPdf.width,
    cropCoordsPdf.height,
  )

  if (rotation !== 0) {
    page.setRotation(degrees(rotation))
  }

  const croppedBytes = await pdfDoc.save()
  const blob = new Blob([croppedBytes], { type: 'application/pdf' })
  const blobUrl = URL.createObjectURL(blob)

  printFrame.src = blobUrl

  const loaded = await Promise.race([
    new Promise((resolve) =>
      printFrame.addEventListener('load', () => resolve(true), { once: true }),
    ),
    new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
  ])

  if (!loaded || !printFrame.contentWindow) {
    URL.revokeObjectURL(blobUrl)
    throw new Error('iframe blob load timeout — CSP probablement bloqué')
  }

  printFrame.contentWindow.print()

  setTimeout(() => {
    URL.revokeObjectURL(blobUrl)
    printFrame.src = 'about:blank'
  }, 60_000)
}

/**
 * Stratégie fallback : rend la zone crop sur un canvas, applique la rotation
 * si nécessaire, puis déclenche window.print().
 *
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {{ x: number, y: number, width: number, height: number }} cropCoordsPdf
 * @param {number} pdfPageHeight
 * @param {HTMLCanvasElement} printCanvas
 * @param {number} [rotation=0]
 * @returns {Promise<void>}
 */
export async function printViaCanvas(page, cropCoordsPdf, pdfPageHeight, printCanvas, rotation = 0) {
  const printScale = 3.0

  // Rendu pleine page hors-écran
  const offscreen = document.createElement('canvas')
  await renderPage(page, offscreen, printScale)

  // Extraction de la zone crop
  const srcX = cropCoordsPdf.x * printScale
  const srcY = (pdfPageHeight - cropCoordsPdf.y - cropCoordsPdf.height) * printScale
  const srcW = cropCoordsPdf.width * printScale
  const srcH = cropCoordsPdf.height * printScale

  // Canvas intermédiaire contenant uniquement la zone crop
  const cropped = document.createElement('canvas')
  cropped.width = srcW
  cropped.height = srcH
  cropped.getContext('2d').drawImage(offscreen, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH)

  // Appliquer la rotation sur le printCanvas final
  applyRotationToCanvas(cropped, printCanvas, rotation)

  printCanvas.style.display = 'block'
  window.print()
  printCanvas.style.display = 'none'
}

/**
 * Copie `src` vers `dest` en appliquant une rotation (multiple de 90°).
 * Adapte automatiquement les dimensions de `dest`.
 *
 * @param {HTMLCanvasElement} src
 * @param {HTMLCanvasElement} dest
 * @param {number} rotation - degrés : 0, 90, -90 (=270), 180
 */
function applyRotationToCanvas(src, dest, rotation) {
  const norm = ((rotation % 360) + 360) % 360 // 0 | 90 | 180 | 270

  if (norm === 0) {
    dest.width = src.width
    dest.height = src.height
    dest.getContext('2d').drawImage(src, 0, 0)
    return
  }

  const swap = norm === 90 || norm === 270
  dest.width  = swap ? src.height : src.width
  dest.height = swap ? src.width  : src.height

  const ctx = dest.getContext('2d')
  ctx.save()

  if (norm === 90) {
    // 90° horaire : top-left → top-right
    ctx.translate(dest.width, 0)
    ctx.rotate(Math.PI / 2)
  } else if (norm === 270) {
    // 90° antihoraire (= -90°) : top-left → bottom-left
    ctx.translate(0, dest.height)
    ctx.rotate(-Math.PI / 2)
  } else {
    // 180°
    ctx.translate(dest.width, dest.height)
    ctx.rotate(Math.PI)
  }

  ctx.drawImage(src, 0, 0)
  ctx.restore()
}
