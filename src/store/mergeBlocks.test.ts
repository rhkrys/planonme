import type { Block } from '../db/types'
import { mergeBlocks } from './mergeBlocks'

function block(id: string, patch: Partial<Block> = {}): Block {
  return { id, title: id, kind: 'talk', durationMin: 5, goal: '', notes: '', script: '', ...patch }
}

const a = block('a')
const b = block('b')
const c = block('c')

test('takes the other side when only one side changed', () => {
  const edited = block('a', { script: 'Hi' })
  expect(mergeBlocks([a, b], [edited, b], [a, b])).toEqual([edited, b])
  expect(mergeBlocks([a, b], [a, b], [edited, b])).toEqual([edited, b])
})

test('keeps edits to different blocks from both sides', () => {
  const theirs = block('a', { script: 'IMPORTANT' })
  const ours = block('b', { title: 'Renamed' })
  expect(mergeBlocks([a, b], [a, ours], [theirs, b])).toEqual([theirs, ours])
})

test('this side wins for a block both sides changed', () => {
  const theirs = block('a', { script: 'theirs' })
  const ours = block('a', { script: 'ours' })
  expect(mergeBlocks([a, b], [ours, b], [theirs, b])).toEqual([ours, b])
})

test('keeps adds and deletes from both sides', () => {
  const d = block('d')
  // We added d after a; they deleted b and added c at the end.
  expect(mergeBlocks([a, b], [a, d, b], [a, c])).toEqual([a, d, c])
})

test('keeps a reorder from this side and an edit from the other', () => {
  const edited = block('a', { notes: 'n' })
  expect(mergeBlocks([a, b, c], [c, a, b], [edited, b, c])).toEqual([c, edited, b])
})
