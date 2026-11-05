// Three way merge of a workshop's blocks, for when another tab saved the same workshop while this
// tab still had an older copy. base is what this tab last read or wrote, ours is this tab's new
// list and theirs is what is stored now. A block this tab did not touch keeps the stored version,
// so an edit in one tab never reverts an edit made in another.

import type { Block } from '../db/types'

function sameBlock(a: Block | undefined, b: Block | undefined): boolean {
  if (!a || !b) return a === b
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.kind === b.kind &&
    a.durationMin === b.durationMin &&
    a.goal === b.goal &&
    a.notes === b.notes &&
    a.script === b.script
  )
}

function sameList(a: readonly Block[], b: readonly Block[]): boolean {
  return a.length === b.length && a.every((block, i) => sameBlock(block, b[i]))
}

/** True when the blocks that list and base share are still in the same order. */
function keptOrder(list: readonly Block[], base: readonly Block[]): boolean {
  const inBase = new Set(base.map((b) => b.id))
  const inList = new Set(list.map((b) => b.id))
  const a = list.filter((b) => inBase.has(b.id))
  const b = base.filter((x) => inList.has(x.id))
  return a.every((block, i) => block.id === b[i]?.id)
}

export function mergeBlocks(
  base: readonly Block[],
  ours: readonly Block[],
  theirs: readonly Block[],
): Block[] {
  if (sameList(theirs, base)) return [...ours]
  if (sameList(ours, base)) return [...theirs]

  const baseById = new Map(base.map((b) => [b.id, b]))
  const oursById = new Map(ours.map((b) => [b.id, b]))
  const theirsById = new Map(theirs.map((b) => [b.id, b]))

  // A block is gone if either side deleted it.
  const deleted = (id: string) => baseById.has(id) && (!oursById.has(id) || !theirsById.has(id))

  function pick(id: string): Block | undefined {
    const mine = oursById.get(id)
    const other = theirsById.get(id)
    const was = baseById.get(id)
    if (mine && (!was || !sameBlock(mine, was))) return mine
    return other ?? mine
  }

  // Keep this tab's order if it reordered, else the stored order. New blocks from the other
  // side go after the blocks that come before them there, or at the end.
  const lead = keptOrder(ours, base) ? theirs : ours
  const other = lead === ours ? theirs : ours
  const ids: string[] = []
  for (const b of lead) if (!deleted(b.id) && !ids.includes(b.id)) ids.push(b.id)
  for (const [i, b] of other.entries()) {
    if (deleted(b.id) || ids.includes(b.id)) continue
    const before = other[i - 1]
    let at = 0
    if (before) {
      const found = ids.indexOf(before.id)
      at = found === -1 ? ids.length : found + 1
    }
    ids.splice(at, 0, b.id)
  }
  return ids.map(pick).filter((b): b is Block => b !== undefined)
}
