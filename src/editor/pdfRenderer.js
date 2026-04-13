import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

/**
 * Charge un PDF depuis un ArrayBuffer, extrait le texte de la page 1
 * et retourne les dimensions en points PDF (scale 1).
 *
 * IMPORTANT : getDocument() consomme (détache) l'ArrayBuffer.
 * Passer arrayBuffer.slice() depuis editor.js et conserver le Uint8Array original.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{
 *   page: import('pdfjs-dist').PDFPageProxy,
 *   textContent: string,
 *   pageWidth: number,
 *   pageHeight: number
 * }>}
 */
export async function loadPdf(arrayBuffer) {
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
  const pdfDoc = await loadingTask.promise

  const page = await pdfDoc.getPage(1) // 1-indexed

  // Dimensions en points PDF à scale 1
  const viewport = page.getViewport({ scale: 1 })

  // Extraction du texte (toutes les spans de la page)
  const textData = await page.getTextContent()
  const textContent = textData.items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ')

  return {
    page,
    textContent,
    pageWidth: viewport.width,
    pageHeight: viewport.height,
  }
}

/**
 * Rend une page PDF sur un canvas à l'échelle donnée.
 * Met à jour canvas.width et canvas.height automatiquement.
 *
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {HTMLCanvasElement} canvas
 * @param {number} scale
 * @returns {Promise<void>}
 */
export async function renderPage(page, canvas, scale) {
  const viewport = page.getViewport({ scale })

  canvas.width = viewport.width
  canvas.height = viewport.height

  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
}
