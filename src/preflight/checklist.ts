// The Zoom pre-flight checklist: live checks of the app plus manual ticks for Zoom.
//
// Everything here is pure, so the view and the tests share the same rules.

import { checkScript, linesOf, type CueContext } from '../cues/check'
import { parseScript } from '../cues/parse'
import type { SoundKind } from '../db/types'

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'checking'

export interface CheckResult {
  status: CheckStatus
  message: string
}

/** What the checks need to know about a workshop's slides and sounds. */
export interface MediaInfo {
  decks: readonly { name: string; slideCount: number }[]
  sounds: readonly { name: string; kind: SoundKind }[]
}

export interface ScriptBlock {
  id: string
  title: string
  script: string
}

/** A problem with one cue in one block's script. */
export interface CueIssue {
  blockId: string
  blockTitle: string
  line: number
  raw: string
  message: string
}

/** The result of decoding one sound: null while it is being checked. */
export type SoundResult = { ok: true } | { ok: false; message: string }

export const LIVE_CHECKS = ['audience', 'slides', 'cues', 'sounds'] as const
export type LiveCheckId = (typeof LIVE_CHECKS)[number]

export interface ManualItem {
  id: string
  label: string
  help: string
  /** Optional items never hold up the ready state. */
  optional?: boolean
}

/** The test tone tick. It sits with the test tone button, not in the Zoom list. */
export const HEARD_TONE: ManualItem = {
  id: 'heard-tone',
  label: 'I heard the test tone',
  help: 'Play the test tone. If you hear nothing, check the master volume in Sounds and your computer volume.',
}

/** The steps in Zoom, in the order you do them. */
export const ZOOM_ITEMS: readonly ManualItem[] = [
  {
    id: 'zoom-share',
    label: 'Click Share screen in Zoom',
    help: 'It is the green button in the Zoom meeting toolbar.',
  },
  {
    id: 'zoom-window',
    label: 'Pick the "PlanOnMe Audience" window',
    help: 'Choose that window, not the whole desktop, so people only see your slides.',
  },
  {
    id: 'zoom-sound',
    label: 'Tick "Share sound"',
    help: 'It is at the bottom of the share dialog. Without it, people do not hear music and effects.',
  },
  {
    id: 'zoom-video',
    label: 'Tick "Optimize for video clip" (optional)',
    help: 'Only if your slides play video. Leave it off for normal slides, so they stay sharp.',
    optional: true,
  },
]

export const MANUAL_ITEMS: readonly ManualItem[] = [HEARD_TONE, ...ZOOM_ITEMS]

const MANUAL_IDS = new Set(MANUAL_ITEMS.map((i) => i.id))

export function isManualId(id: unknown): id is string {
  return typeof id === 'string' && MANUAL_IDS.has(id)
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function audienceCheck(connected: boolean): CheckResult {
  return connected
    ? { status: 'ok', message: 'The audience window is open and connected.' }
    : {
        status: 'fail',
        message: 'The audience window is not open. Open it, then share it in Zoom.',
      }
}

export function slidesCheck(media: MediaInfo | null): CheckResult {
  if (!media) return { status: 'fail', message: 'Could not read the slides. Reload the page.' }
  const slides = media.decks.reduce((sum, d) => sum + d.slideCount, 0)
  if (slides === 0)
    return { status: 'warn', message: 'There are no slides yet. Add them in Slides.' }
  const decks = plural(media.decks.length, 'deck', 'decks')
  return { status: 'ok', message: `${plural(slides, 'slide', 'slides')} in ${decks}.` }
}

function toContext(media: MediaInfo): CueContext {
  return {
    slideCount: media.decks.reduce((sum, d) => sum + d.slideCount, 0),
    sounds: media.sounds,
  }
}

/**
 * Every cue problem in every block, in block and text order. The same checks as the Script
 * view. Without media, only malformed cues are found.
 */
export function findCueIssues(
  blocks: readonly ScriptBlock[],
  media: MediaInfo | null,
): { cues: number; issues: CueIssue[] } {
  const context = media ? toContext(media) : null
  let cues = 0
  const issues: CueIssue[] = []
  for (const block of blocks) {
    const text = typeof block.script === 'string' ? block.script : ''
    const parsed = parseScript(text)
    const problems = checkScript(parsed, context)
    cues += parsed.cues.length + parsed.invalid.length
    const lines = linesOf(
      text,
      problems.map((p) => p.start),
    )
    problems.forEach((p, i) => {
      issues.push({
        blockId: block.id,
        blockTitle: block.title.trim() || 'Untitled block',
        line: lines[i] ?? 1,
        raw: p.raw,
        message: p.message,
      })
    })
  }
  return { cues, issues }
}

export function cuesCheck(
  cues: number,
  issues: readonly CueIssue[],
  media: MediaInfo | null,
): CheckResult {
  if (issues.length > 0) {
    return {
      status: 'fail',
      message: `${plural(issues.length, 'cue needs', 'cues need')} fixing in Script. Run mode skips them.`,
    }
  }
  if (!media) {
    return {
      status: 'warn',
      message: 'Could not read the slides and sounds, so cues were not fully checked.',
    }
  }
  if (cues === 0) return { status: 'ok', message: 'The script has no cues.' }
  return { status: 'ok', message: `All ${plural(cues, 'cue', 'cues')} are valid.` }
}

/**
 * The sounds check. sounds is null while the library loads. results holds what decoding found
 * so far, by sound id.
 */
export function soundsCheck(
  sounds: readonly { id: string; name: string }[] | null,
  results: Readonly<Record<string, SoundResult | undefined>>,
  failed: boolean,
): CheckResult {
  if (failed) return { status: 'fail', message: 'Could not read the sounds. Reload the page.' }
  if (!sounds) return { status: 'checking', message: 'Loading sounds...' }
  if (sounds.length === 0) return { status: 'ok', message: 'This workshop has no sounds.' }
  let bad = 0
  let pending = 0
  for (const s of sounds) {
    const r = results[s.id]
    if (!r) pending++
    else if (!r.ok) bad++
  }
  if (bad > 0) {
    return {
      status: 'fail',
      message: `${plural(bad, 'sound does', 'sounds do')} not play. Replace ${bad === 1 ? 'it' : 'them'} in Sounds.`,
    }
  }
  if (pending > 0) {
    const done = sounds.length - pending
    return { status: 'checking', message: `Checking sounds... ${done} of ${sounds.length}.` }
  }
  return { status: 'ok', message: `All ${plural(sounds.length, 'sound plays', 'sounds play')}.` }
}

/** A warning about the master volume, or null when it is fine. */
export function masterWarning(master: number): string | null {
  if (!(master > 0))
    return 'The master volume is at 0. Turn it up in Sounds, or nobody hears anything.'
  if (master < 0.2) return 'The master volume is very low. You may want to turn it up in Sounds.'
  return null
}

export interface Progress {
  done: number
  total: number
  /** True when every live check is ok and every required tick is ticked. */
  ready: boolean
}

/** How many of the required items are done. Optional ticks do not count. */
export function progress(
  live: Readonly<Record<LiveCheckId, CheckResult>>,
  ticks: readonly string[],
): Progress {
  const ticked = new Set(ticks)
  const required = MANUAL_ITEMS.filter((i) => !i.optional)
  let done = 0
  for (const id of LIVE_CHECKS) if (live[id].status === 'ok') done++
  for (const item of required) if (ticked.has(item.id)) done++
  const total = LIVE_CHECKS.length + required.length
  return { done, total, ready: done === total }
}
