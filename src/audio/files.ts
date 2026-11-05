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
