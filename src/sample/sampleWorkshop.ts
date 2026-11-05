// A small demo workshop with blocks, a script with cues, a slide deck and a few sounds. All
// media is made in code, so the sample works offline and needs no downloaded files.

import { encodeWav, renderTones, type Tone } from '../audio/wav'
import { newId } from '../db/ids'
import { encodeSlideImage } from '../slides/encode'
import type { Block, SlideDeck, Sound } from '../db/types'

export const SAMPLE_TITLE = 'Sample workshop'

export interface SampleSlide {
  title: string
  subtitle: string
}

export interface SampleWorkshop {
  title: string
  durationMin: number
  blocks: Block[]
  decks: Omit<SlideDeck, 'id' | 'workshopId'>[]
  sounds: Omit<Sound, 'id' | 'workshopId'>[]
}

export const SAMPLE_SLIDES: readonly SampleSlide[] = [
  { title: 'Welcome', subtitle: 'A PlanOnMe sample workshop' },
  { title: 'Today', subtitle: 'Warm-up, break and wrap-up' },
  { title: 'Warm-up', subtitle: 'Share one goal with a partner' },
  { title: 'Break', subtitle: 'Back in five minutes' },
  { title: 'Thank you', subtitle: 'Questions and next steps' },
]

const SAMPLE_RATE = 22050

function wav(tones: Tone[], seconds: number): Blob {
  return new Blob([encodeWav(renderTones(tones, seconds, SAMPLE_RATE), SAMPLE_RATE)], {
    type: 'audio/wav',
  })
}

/** Two bell tones, like a door chime. */
function chime(): Blob {
  return wav(
    [
      { at: 0, freq: 880, length: 1.2, level: 0.5, decay: 3 },
      { at: 0.25, freq: 660, length: 1.2, level: 0.5, decay: 3 },
    ],
    1.5,
  )
}

/** One short high tone. */
function ding(): Blob {
  return wav([{ at: 0, freq: 1320, length: 0.6, level: 0.5, decay: 6 }], 0.6)
}

/** A calm eight second loop of soft notes, for the break. */
function breakMusic(): Blob {
  const notes = [262, 330, 392, 523, 392, 330, 294, 349, 440, 587, 440, 349]
  const step = 8 / notes.length
  const tones: Tone[] = notes.flatMap((freq, i) => [
    { at: i * step, freq, length: step * 1.5, level: 0.25, decay: 1.5 },
    { at: i * step, freq: freq / 2, length: step * 1.5, level: 0.12, decay: 1 },
  ])
  return wav(tones, 8)
}

function block(
  title: string,
  kind: Block['kind'],
  durationMin: number,
  goal: string,
  script: string,
): Block {
  return { id: newId(), title, kind, durationMin, goal, notes: '', script }
}

/** The blocks of the sample, with scripts that use every kind of cue. */
export function sampleBlocks(): Block[] {
  return [
    block(
      'Welcome',
      'talk',
      5,
      'Set the tone and show the plan.',
      '[SLIDE 1] Good morning, and welcome to this sample workshop. [SFX Chime]\n' +
        'I am glad you are here.\n\n' +
        '[SLIDE 2] Here is the plan for today: a warm-up, a short break and a wrap-up.',
    ),
    block(
      'Warm-up',
      'exercise',
      10,
      'Everyone speaks once.',
      '[SLIDE 3] Find a partner and share one goal you have for today.\n' +
        'You have two minutes. [TIMER 2m]\n\n' +
        '[SFX Ding] Time is up. Thank you all.',
    ),
    block(
      'Break',
      'break',
      5,
      '',
      '[SLIDE 4] Let us take a short break. [MUSIC Break music]\n' +
        'See you in five minutes.\n\n' +
        '[STOP MUSIC] Welcome back.',
    ),
    block(
      'Wrap-up',
      'discussion',
      10,
      'Each person names one next step.',
      '[SLIDE 5] What is one thing you will try next week? [SFX Chime]\n' +
        'Thank you for joining.',
    ),
  ]
}

/** The sounds the sample script uses. */
export function sampleSounds(): SampleWorkshop['sounds'] {
  return [
    {
      name: 'Chime',
      kind: 'sfx',
      blob: chime(),
      loop: false,
      volume: 0.8,
      hotkey: 'c',
      color: '#16a34a',
    },
    { name: 'Ding', kind: 'sfx', blob: ding(), loop: false, volume: 0.8, hotkey: 'd', color: '' },
    {
      name: 'Break music',
      kind: 'music',
      blob: breakMusic(),
      loop: true,
      volume: 0.6,
      hotkey: 'm',
      color: '#4f46e5',
    },
  ]
}

/** Turns one slide into an image. Injected so tests can run without a canvas. */
export type SlideRenderer = (slide: SampleSlide, index: number, count: number) => Promise<Blob>

export const SLIDE_WIDTH = 1280
export const SLIDE_HEIGHT = 720

/** Draws a slide on a canvas as a WebP or JPEG image. Throws if the browser cannot draw. */
export const drawSlide: SlideRenderer = async (slide, index, count) => {
  const canvas = document.createElement('canvas')
  canvas.width = SLIDE_WIDTH
  canvas.height = SLIDE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas')
  const hue = 240 + index * 25
  const gradient = ctx.createLinearGradient(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT)
  gradient.addColorStop(0, `hsl(${hue}, 55%, 28%)`)
  gradient.addColorStop(1, `hsl(${hue + 30}, 60%, 18%)`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT)
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 110px system-ui, sans-serif'
  ctx.fillText(slide.title, SLIDE_WIDTH / 2, SLIDE_HEIGHT / 2 - 50)
  ctx.font = '48px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.fillText(slide.subtitle, SLIDE_WIDTH / 2, SLIDE_HEIGHT / 2 + 70)
  ctx.font = '28px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
  ctx.textAlign = 'right'
  ctx.fillText(`${index + 1} / ${count}`, SLIDE_WIDTH - 48, SLIDE_HEIGHT - 40)
  // WebP or JPEG, like imported PDF pages. A PNG of this gradient is about 100 times larger.
  return encodeSlideImage(canvas)
}

/** Builds the whole sample workshop. Slides are drawn with render. */
export async function buildSampleWorkshop(
  render: SlideRenderer = drawSlide,
): Promise<SampleWorkshop> {
  const slides: Blob[] = []
  for (const [i, slide] of SAMPLE_SLIDES.entries()) {
    slides.push(await render(slide, i, SAMPLE_SLIDES.length))
  }
  return {
    title: SAMPLE_TITLE,
    durationMin: 30,
    blocks: sampleBlocks(),
    decks: [{ name: 'Sample slides', source: 'pdf', slides }],
    sounds: sampleSounds(),
  }
}
