const MB = 1024 * 1024

/** Caps that keep stored and imported data within sane sizes. */
export const LIMITS = {
  /** Largest backup file we try to read. Also keeps the text under the browser string limit. */
  maxFileBytes: 500 * MB,
  /** Total decoded media (slides plus sounds) in one workshop backup. */
  maxMediaBytes: 500 * MB,
  maxSlideBytes: 20 * MB,
  maxSoundBytes: 100 * MB,
  /** All sounds of one workshop together, so the workshop still fits in a backup file. */
  maxSoundBytesTotal: 300 * MB,
  maxBlocks: 500,
  maxDecks: 50,
  maxSlidesPerDeck: 500,
  maxSlidesTotal: 2000,
  maxSounds: 200,
  maxTitleLength: 200,
  maxGoalLength: 2000,
  maxNotesLength: 20_000,
  maxScriptLength: 100_000,
  maxHotkeyLength: 20,
  maxMimeLength: 100,
  maxIdLength: 100,
  maxWorkshopMinutes: 7 * 24 * 60,
  maxBlockMinutes: 24 * 60,
} as const

export const SLIDE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
export const AUDIO_TYPE_PATTERN = /^audio\/[a-z0-9.+-]+$/i
