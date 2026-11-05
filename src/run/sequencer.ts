// The cue sequencer of Run mode. Pure functions over a flat list of every cue in the workshop
// script, so the order of GO, Back and jumps is easy to test. Scripts and media are untrusted,
// so nothing here throws: a cue that can not fire is kept in the list with a problem and is
// skipped by GO.

import { checkScript, findSound, type CueContext } from '../cues/check'
import type { MediaNames } from '../cues/describe'
import { parseScript, type Cue, type Segment } from '../cues/parse'
import type { BlockKind } from '../db/types'

export interface RunCue {
  /** Position in RunPlan.cues. */
  index: number
  /** Position of its block in RunPlan.blocks. */
  blockIndex: number
  /** The cue, or null for a token with a known keyword but a bad argument. */
  cue: Cue | null
  /** The token as written. */
  raw: string
  /** Where the token is in its block's script. */
  start: number
  end: number
  /** Why this cue can not fire, or null when it can. */
  problem: string | null
}

export interface RunBlock {
  id: string
  title: string
  kind: BlockKind
  durationMin: number
  script: string
  segments: Segment[]
  /** Index in RunPlan.cues of this block's first cue. Equal to the next block's when empty. */
  firstCue: number
  cueCount: number
}

export interface RunPlan {
  blocks: RunBlock[]
  cues: RunCue[]
}

/** The planned block that is running, and the last cue fired (-1 before the first one). */
export interface Position {
  cue: number
  block: number
}

export const START: Position = { cue: -1, block: 0 }

export interface BlockInput {
  id: string
  title: string
  kind: BlockKind
  durationMin: number
  script: string
}

/** Turns the media summary into what the cue check needs, or null if media is unknown. */
function toContext(media: MediaNames | null): CueContext | null {
  if (!media) return null
  return {
    slideCount: media.decks.reduce((sum, d) => sum + Math.max(0, d.slideCount), 0),
    sounds: media.sounds,
  }
}

/**
 * Builds the run list from the blocks and the media. When media is null (it could not be read),
 * slide and sound cues can not fire and are marked with a problem.
 */
export function buildRunPlan(blocks: readonly BlockInput[], media: MediaNames | null): RunPlan {
  const context = toContext(media)
  const runBlocks: RunBlock[] = []
  const cues: RunCue[] = []
  blocks.forEach((b, blockIndex) => {
    const script = typeof b.script === 'string' ? b.script : ''
    const parsed = parseScript(script)
    const problems = new Map(checkScript(parsed, context).map((p) => [p.start, p.message]))
    const firstCue = cues.length
    for (const seg of parsed.segments) {
      if (seg.kind === 'text') continue
      let problem: string | null = problems.get(seg.start) ?? null
      const cue = seg.kind === 'cue' ? seg.cue : null
      if (!problem && !context && cue && cue.type !== 'timer' && cue.type !== 'stopMusic') {
        problem = 'Slides and sounds could not be read.'
      }
      if (!problem && !cue) problem = 'This cue is not complete.'
      cues.push({
        index: cues.length,
        blockIndex,
        cue,
        raw: seg.raw,
        start: seg.start,
        end: seg.end,
        problem,
      })
    }
    runBlocks.push({
      id: b.id,
      title: b.title,
      kind: b.kind,
      durationMin: b.durationMin,
      script,
      segments: parsed.segments,
      firstCue,
      cueCount: cues.length - firstCue,
    })
  })
  return { blocks: runBlocks, cues }
}

export function canFire(cue: RunCue | undefined): cue is RunCue & { cue: Cue } {
  return !!cue && cue.cue !== null && cue.problem === null
}

/** Keeps a position inside the plan, for example after the script got shorter. */
export function clampPosition(plan: RunPlan, pos: Position): Position {
  const lastBlock = Math.max(0, plan.blocks.length - 1)
  const block = Number.isInteger(pos.block) ? Math.min(Math.max(0, pos.block), lastBlock) : 0
  const cue = Number.isInteger(pos.cue) ? Math.min(Math.max(-1, pos.cue), plan.cues.length - 1) : -1
  if (block === pos.block && cue === pos.cue) return pos
  return { cue, block }
}

/** The cue that was fired last and belongs to the running block, or null. */
export function currentCue(plan: RunPlan, pos: Position): RunCue | null {
  const c = plan.cues[pos.cue]
  return c && c.blockIndex === pos.block ? c : null
}

/** The next cue GO will fire, or null at the end. */
export function nextCue(plan: RunPlan, pos: Position): RunCue | null {
  for (let i = Math.max(-1, pos.cue) + 1; i < plan.cues.length; i++) {
    const c = plan.cues[i]
    if (canFire(c)) return c
  }
  return null
}

/** The next slide cue GO will reach, or null. */
export function nextSlideCue(plan: RunPlan, pos: Position): (RunCue & { cue: Cue }) | null {
  for (let i = Math.max(-1, pos.cue) + 1; i < plan.cues.length; i++) {
    const c = plan.cues[i]
    if (canFire(c) && c.cue.type === 'slide') return c
  }
  return null
}

export interface GoResult {
  pos: Position
  /** The cue to fire, or null when there are no more cues or GO entered a block. */
  fired: (RunCue & { cue: Cue }) | null
  /**
   * The index of the block GO moved into without firing anything, because that block has no
   * cue that can fire (a break with only spoken text, for example). Null otherwise.
   */
  entered: number | null
  /** Cues passed over because they can not fire, in order. */
  skipped: RunCue[]
}

/**
 * GO: moves to the next cue that can fire, passing over the ones that can not. A block with
 * nothing to fire is never passed over: GO moves into it, so it becomes the running block and
 * its time counts. The next GO then goes on from there.
 */
export function go(plan: RunPlan, from: Position): GoResult {
  const pos = clampPosition(plan, from)
  const skipped: RunCue[] = []
  const nextBlock = pos.block + 1
  let i = pos.cue + 1
  for (; i < plan.cues.length; i++) {
    const c = plan.cues[i]
    if (!c) break
    // Past the next block: that block has nothing to fire.
    if (c.blockIndex > nextBlock) break
    if (canFire(c)) {
      return { pos: { cue: i, block: c.blockIndex }, fired: c, skipped, entered: null }
    }
    skipped.push(c)
  }
  if (nextBlock < plan.blocks.length) {
    return { pos: { cue: i - 1, block: nextBlock }, fired: null, skipped, entered: nextBlock }
  }
  // Nothing left to fire. The position stays, so Back still steps from the last fired cue.
  return { pos, fired: null, skipped, entered: null }
}

/**
 * Back: steps back one cue without firing anything. At the start of a block (no cue of it
 * fired yet), it goes back to the cue fired before the block.
 */
export function back(plan: RunPlan, from: Position): Position {
  const pos = clampPosition(plan, from)
  const at = plan.cues[pos.cue]
  if (!at || at.blockIndex !== pos.block || !canFire(at)) {
    // At the start of a block, or past cues that were skipped.
    for (let i = pos.cue; i >= 0; i--) {
      const c = plan.cues[i]
      if (canFire(c)) return { cue: i, block: c.blockIndex }
    }
    return pos.block > 0 ? jumpToBlock(plan, pos.block - 1) : { cue: -1, block: 0 }
  }
  for (let i = pos.cue - 1; i >= 0; i--) {
    const c = plan.cues[i]
    if (canFire(c)) return { cue: i, block: c.blockIndex }
  }
  return jumpToBlock(plan, pos.block)
}

/** Makes a cue the current one, without firing it. Null for a cue that can not fire. */
export function jumpToCue(plan: RunPlan, index: number): Position | null {
  const c = plan.cues[index]
  return canFire(c) ? { cue: index, block: c.blockIndex } : null
}

/** Starts a block: GO then fires its first cue. */
export function jumpToBlock(plan: RunPlan, blockIndex: number): Position {
  const b = plan.blocks[blockIndex]
  if (!b) return clampPosition(plan, START)
  return { cue: b.firstCue - 1, block: blockIndex }
}

/**
 * Where a position is in the script in a form that survives edits: the block by id, the cue by
 * its place in that block, and the cue text. Cue indexes alone move when any earlier script or
 * the block order changes.
 */
export interface Anchor {
  blockId: string
  /** Index of the cue in its block, -1 before the block's first cue. */
  offset: number
  /** The text of that cue, or null before the block's first cue. */
  raw: string | null
}

export function anchorOf(plan: RunPlan, pos: Position): Anchor | null {
  const b = plan.blocks[pos.block]
  if (!b) return null
  const offset = pos.cue - b.firstCue
  const c = plan.cues[pos.cue]
  const inBlock = !!c && c.blockIndex === pos.block
  return {
    blockId: b.id,
    offset: inBlock ? offset : Math.min(offset, -1),
    raw: inBlock ? c.raw : null,
  }
}

/**
 * The position an anchor points at in a plan, or null when its block is gone. When the cue text
 * moved inside its block, the nearest cue with the same text is used.
 */
export function positionOf(plan: RunPlan, anchor: Anchor): Position | null {
  const block = plan.blocks.findIndex((b) => b.id === anchor.blockId)
  const b = plan.blocks[block]
  if (!b) return null
  if (anchor.raw === null || anchor.offset < 0) return { cue: b.firstCue - 1, block }
  let best = -1
  for (let k = 0; k < b.cueCount; k++) {
    if (plan.cues[b.firstCue + k]?.raw !== anchor.raw) continue
    if (best === -1 || Math.abs(k - anchor.offset) < Math.abs(best - anchor.offset)) best = k
  }
  if (best === -1) best = Math.min(anchor.offset, b.cueCount - 1)
  return { cue: b.firstCue + best, block }
}

/** The slide the audience should see at a position: the last slide cue at or before it. */
export function slideAt(plan: RunPlan, pos: Position): number | null {
  for (let i = Math.min(pos.cue, plan.cues.length - 1); i >= 0; i--) {
    const c = plan.cues[i]
    if (canFire(c) && c.cue.type === 'slide') return c.cue.slide
  }
  return null
}

/** True when the named sound exists, for checks outside the plan. */
export function hasSound(media: MediaNames | null, name: string): boolean {
  return !!media && findSound(media.sounds, name) !== null
}
