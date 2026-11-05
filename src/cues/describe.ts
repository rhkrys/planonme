import type { SoundKind } from '../db/types'
import { findSound } from './check'
import { formatTimer, type Cue } from './parse'

/** The names and counts of a workshop's slides and sounds, as the media summary holds them. */
export interface MediaNames {
  decks: readonly { name: string; slideCount: number }[]
  sounds: readonly { name: string; kind: SoundKind }[]
}

/** "Slide 4: Intro, slide 2" for a global slide number, or "Slide 4" if it is not found. */
export function slideLabel(slide: number, media: MediaNames | null): string {
  if (!media) return `Slide ${slide}`
  let left = slide
  for (const d of media.decks) {
    if (left <= d.slideCount) return `Slide ${slide}: ${d.name}, slide ${left}`
    left -= d.slideCount
  }
  return `Slide ${slide}`
}

/** A short readable description of a cue, such as "Music: Break loop". */
export function describeCue(cue: Cue, media: MediaNames | null): string {
  switch (cue.type) {
    case 'slide':
      return slideLabel(cue.slide, media)
    case 'sfx':
    case 'music': {
      const sound = media ? findSound(media.sounds, cue.name) : null
      const what = cue.type === 'sfx' ? 'Sound effect' : 'Music'
      return `${what}: ${sound?.name ?? cue.name}`
    }
    case 'stopMusic':
      return 'Stop the music'
    case 'timer':
      return `Timer: ${formatTimer(cue.seconds)}`
  }
}
