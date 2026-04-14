/**
 * process-logos.mjs
 *
 * Removes white background from the source logos and generates
 * the 4 icon sizes required by the Chrome extension.
 *
 * Usage:
 *   node scripts/process-logos.mjs
 *
 * Prerequisites:
 *   - Place source files in assets/design/:
 *       logo-flat.png   (horizontal: icon + "MMShip" text)
 *       logo-icon.png   (icon only, no text)
 *       logo-full.png   (vertical: icon above "MMShip" text)
 *
 *   - Run this script once. Outputs:
 *       assets/design/*.png          (same files, white bg replaced by transparency)
 *       assets/icons/icon-{16,32,48,128}.png
 */

import sharp from 'sharp'
import { readFile, writeFile } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// ─── Remove white background ──────────────────────────────────────────────────
// Pixels with R,G,B all above `threshold` are made fully transparent.
// Tolerance handles near-white anti-aliasing edges.
async function removeWhiteBackground(inputPath, outputPath, threshold = 240) {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height, channels } = info
  const buf = Buffer.from(data)

  for (let i = 0; i < buf.length; i += channels) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2]
    if (r >= threshold && g >= threshold && b >= threshold) {
      buf[i + 3] = 0 // fully transparent
    }
  }

  await sharp(buf, { raw: { width, height, channels } })
    .png()
    .toFile(outputPath)

  console.log(`  ✓ ${outputPath.replace(root + '/', '')}`)
}

// ─── Generate icon sizes (white background + rounded corners) ─────────────────
// Produces a modern favicon-style icon: white square, rounded corners (~20%),
// logo centered on top. The white background is intentional and not removed.
async function generateIcons(sourceFile) {
  const sizes = [16, 32, 48, 128]

  for (const size of sizes) {
    const dest   = resolve(root, `assets/icons/icon-${size}.png`)
    const radius = Math.round(size * 0.20)
    const pad    = Math.round(size * 0.10) // 10% padding around the logo

    // White rounded-corner background as SVG
    const bg = Buffer.from(
      `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
         <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/>
       </svg>`,
    )

    // Resize the logo to fit inside the padding box
    const inner = size - pad * 2
    const logoResized = await sharp(sourceFile)
      .ensureAlpha()
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()

    await sharp(bg)
      .composite([{ input: logoResized, top: pad, left: pad }])
      .png()
      .toFile(dest)

    console.log(`  ✓ assets/icons/icon-${size}.png`)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const sources = ['logo-flat', 'logo-icon', 'logo-full']

  console.log('\nRemoving white backgrounds…')
  for (const name of sources) {
    const path = resolve(root, `assets/design/${name}.png`)
    try {
      await removeWhiteBackground(path, path)
    } catch (e) {
      console.warn(`  ⚠ assets/design/${name}.png not found — skipping`)
    }
  }

  console.log('\nGenerating extension icons from logo-full.png…')
  const iconSource = resolve(root, 'assets/design/logo-full.png')
  try {
    await generateIcons(iconSource)
  } catch (e) {
    console.warn('  ⚠ assets/design/logo-full.png not found — skipping icon generation')
  }

  console.log('\nDone. Run `npm run build` to rebuild the extension.\n')
}

main()
