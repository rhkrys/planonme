// Draws the PlanOnMe app icons as PNG files in public/. Run with: node scripts/make-icons.mjs
// The design matches public/icon.svg: a rounded indigo square with a white play triangle.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BG = [0x4f, 0x46, 0xe5]
const FG = [0xff, 0xff, 0xff]
const SAMPLES = 4

function crc32(bytes) {
  let crc = ~0
  for (const b of bytes) {
    crc ^= b
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // no filter
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Point in the rounded square of a 32 unit grid. */
function inRoundedSquare(x, y, r) {
  if (x < 0 || y < 0 || x > 32 || y > 32) return false
  const cx = Math.min(Math.max(x, r), 32 - r)
  const cy = Math.min(Math.max(y, r), 32 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

/** Point in the play triangle (11,9) (11,23) (23,16), scaled around the center. */
function inTriangle(x, y, scale) {
  const ux = (x - 16) / scale + 16
  const uy = (y - 16) / scale + 16
  if (ux < 11) return false
  // The two slanted edges meet at (23, 16).
  const half = ((23 - ux) / 12) * 7
  return uy >= 16 - half && uy <= 16 + half
}

function draw(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4)
  const unit = 32 / size
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0
      let fg = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) * unit
          const y = (py + (sy + 0.5) / SAMPLES) * unit
          // A maskable icon fills the whole square, and keeps the mark inside the safe zone.
          const inside = maskable ? true : inRoundedSquare(x, y, 7)
          if (!inside) continue
          if (inTriangle(x, y, maskable ? 0.8 : 1)) fg++
          else bg++
        }
      }
      const total = SAMPLES * SAMPLES
      const alpha = (bg + fg) / total
      const i = (py * size + px) * 4
      for (let c = 0; c < 3; c++) {
        const v = bg + fg === 0 ? 0 : (BG[c] * bg + FG[c] * fg) / (bg + fg)
        rgba[i + c] = Math.round(v)
      }
      rgba[i + 3] = Math.round(alpha * 255)
    }
  }
  return encodePng(size, rgba)
}

const icons = [
  ['public/icon-192.png', 192, false],
  ['public/icon-512.png', 512, false],
  ['public/icon-maskable-512.png', 512, true],
  ['public/apple-touch-icon.png', 180, true],
]
for (const [path, size, maskable] of icons) {
  writeFileSync(path, draw(size, { maskable }))
  console.log(`Wrote ${path}`)
}
