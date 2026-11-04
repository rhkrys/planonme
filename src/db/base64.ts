// Chunked base64 helpers. Chunks keep memory and call stack use bounded for large media.

const ENCODE_CHUNK = 3 * 8192
const DECODE_CHUNK = 4 * 8192
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += ENCODE_CHUNK) {
    const chunk = bytes.subarray(i, i + ENCODE_CHUNK)
    let binary = ''
    for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j] ?? 0)
    parts.push(btoa(binary))
  }
  return parts.join('')
}

/** True when the text is well formed, padded base64 with no whitespace. */
export function isBase64(text: string): boolean {
  if (text.length % 4 !== 0) return false
  if (!BASE64_PATTERN.test(text)) return false
  // Padding may only appear at the very end.
  const pad = text.indexOf('=')
  return pad === -1 || pad >= text.length - 2
}

/** Byte length the base64 text decodes to. Only meaningful when isBase64 is true. */
export function base64DecodedLength(text: string): number {
  if (text.length === 0) return 0
  let padding = 0
  if (text.endsWith('==')) padding = 2
  else if (text.endsWith('=')) padding = 1
  return (text.length / 4) * 3 - padding
}

/** Decodes base64 text. Throws when the text is not valid base64. */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  if (!isBase64(text)) throw new Error('Invalid base64 data')
  const out = new Uint8Array(base64DecodedLength(text))
  let offset = 0
  for (let i = 0; i < text.length; i += DECODE_CHUNK) {
    const binary = atob(text.slice(i, i + DECODE_CHUNK))
    for (let j = 0; j < binary.length; j++) {
      if (offset >= out.length) throw new Error('Invalid base64 data')
      out[offset++] = binary.charCodeAt(j)
    }
  }
  if (offset !== out.length) throw new Error('Invalid base64 data')
  return out
}
