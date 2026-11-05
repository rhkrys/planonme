import { LIMITS } from '../db/limits'
import { isAudioType } from '../db/normalize'
import { cleanSoundName } from '../db/repo'
import type { SoundKind } from '../db/types'

export const MAX_SOUND_BYTES = LIMITS.maxSoundBytes
/** Most files taken from one pick or drop. */
export const MAX_FILES_AT_ONCE = 20
/** With kind 'auto', sounds at least this long (in seconds) count as music. */
export const MUSIC_MIN_SECONDS = 20

const TYPES_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  wave: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  webm: 'audio/webm',
  weba: 'audio/webm',
}

/** What the file picker accepts. */
export const AUDIO_ACCEPT = [
  'audio/*',
  ...Object.keys(TYPES_BY_EXTENSION).map((e) => `.${e}`),
].join(',')

function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  return m?.[1]?.toLowerCase() ?? ''
}

/**
 * The audio type to store a file with, or null if it does not look like audio. Browsers leave
 * the type empty for some files, so the extension is used then.
 */
export function audioTypeOf(file: { name: string; type: string }): string | null {
  const type = file.type.toLowerCase()
  if (type && isAudioType(type)) return type
  if (type === 'video/webm' || type === 'video/mp4' || type === 'video/ogg') {
    return type.replace('video/', 'audio/')
  }
  if (type && type !== 'application/octet-stream') return null
  return TYPES_BY_EXTENSION[extensionOf(file.name)] ?? null
}

function ascii(bytes: Uint8Array, start: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (bytes[start + i] !== text.charCodeAt(i)) return false
  }
  return true
}

/** How many bytes from the start of a file sniffAudioType needs. */
export const SNIFF_BYTES = 12

/**
 * The audio type that the first bytes of a file point to, or null. Used for files that come
 * without a type and without a known extension.
 */
export function sniffAudioType(head: Uint8Array): string | null {
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WAVE')) return 'audio/wav'
  if (ascii(head, 0, 'OggS')) return 'audio/ogg'
  if (ascii(head, 0, 'fLaC')) return 'audio/flac'
  if (ascii(head, 0, 'ID3')) return 'audio/mpeg'
  if (ascii(head, 4, 'ftyp')) return 'audio/mp4'
  const [a = 0, b = 0, c = 0, d = 0] = head
  if (a === 0x1a && b === 0x45 && c === 0xdf && d === 0xa3) return 'audio/webm'
  // MPEG audio frame sync (MP3) or ADTS (AAC).
  if (a === 0xff && (b & 0xf6) === 0xf0) return 'audio/aac'
  if (a === 0xff && (b & 0xe0) === 0xe0) return 'audio/mpeg'
  return null
}

/**
 * Like audioTypeOf, but when the file has no type and no known extension, looks at its first
 * bytes. Never throws: a file that cannot be read gives null.
 */
export async function detectAudioType(file: Blob & { name: string }): Promise<string | null> {
  const known = audioTypeOf(file)
  if (known) return known
  if (file.type && file.type.toLowerCase() !== 'application/octet-stream') return null
  try {
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer())
    return sniffAudioType(head)
  } catch {
    return null
  }
}

/** A sound name made from a file name, without the extension. */
export function soundNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ')
  return cleanSoundName(base)
}

export type KindChoice = SoundKind | 'auto'

export function pickKind(choice: KindChoice, durationSeconds: number): SoundKind {
  if (choice !== 'auto') return choice
  return durationSeconds >= MUSIC_MIN_SECONDS ? 'music' : 'sfx'
}
