import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { audioEngine, DecodeError, type PlayingInfo } from '../../audio/engine'
import {
  AUDIO_ACCEPT,
  detectAudioType,
  MAX_FILES_AT_ONCE,
  MAX_SOUND_BYTES,
  MUSIC_MIN_SECONDS,
  pickKind,
  soundNameFromFile,
  type KindChoice,
} from '../../audio/files'
import { hotkeyLabel, hotkeyProblem, normalizeHotkey } from '../../audio/hotkeys'
import { useSoundLibrary } from '../../audio/library'
import { soundKey } from '../../cues/check'
import { LIMITS } from '../../db/limits'
import { SOUND_KINDS, type Sound, type SoundKind } from '../../db/types'
import { useWorkshopStore, workshopStore } from '../../store/workshopStore'

const MB = 1024 * 1024

const KIND_NAMES: Record<SoundKind, string> = { music: 'Music', sfx: 'Effect' }

const SOUND_COLORS: { label: string; value: string }[] = [
  { label: 'Default', value: '' },
  { label: 'Red', value: '#e5484d' },
  { label: 'Orange', value: '#f76b15' },
  { label: 'Yellow', value: '#ffc53d' },
  { label: 'Green', value: '#30a46c' },
  { label: 'Teal', value: '#12a594' },
  { label: 'Blue', value: '#0090ff' },
  { label: 'Purple', value: '#8e4ec6' },
  { label: 'Pink', value: '#d6409f' },
  { label: 'Gray', value: '#8b8d98' },
]

function useEngine() {
  return useSyncExternalStore(audioEngine.subscribe, audioEngine.getSnapshot)
}

function formatSeconds(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const total = Math.round(s)
  const m = Math.floor(total / 60)
  const sec = total % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function SoundsView() {
  const status = useWorkshopStore((s) => s.status)
  const currentId = useWorkshopStore((s) => s.currentId)
  const libraryId = useSoundLibrary((s) => s.workshopId)
  const librarySounds = useSoundLibrary((s) => s.sounds)
  const failed = useSoundLibrary((s) => s.failed)

  if (status !== 'ready' || !currentId) {
    return (
      <section className="sounds-view">
        <h1>Sounds</h1>
        <p className="muted">{status === 'error' ? 'No workshop is open.' : 'Loading...'}</p>
      </section>
    )
  }

  const sounds = libraryId === currentId ? librarySounds : null

  return (
    <section className="sounds-view">
      <h1>Sounds</h1>
      <PlayerBar />
      <UploadPanel key={currentId} sounds={sounds} />
      {failed && libraryId === currentId && (
        <p className="message error" role="alert">
          Could not read the sounds. Reload the page to try again.
        </p>
      )}
      {sounds === null ? <p className="muted">Loading sounds...</p> : <PadGrid sounds={sounds} />}
    </section>
  )
}

function PlayerBar() {
  const engine = useEngine()
  const playingCount = Object.keys(engine.playing).length
  const percent = Math.round(engine.master * 100)
  return (
    <div className="player-bar">
      <div className="master">
        <label htmlFor="master-volume">Master volume</label>
        <input
          id="master-volume"
          type="range"
          min={0}
          max={100}
          step={1}
          value={percent}
          aria-valuetext={`${percent}%`}
          onChange={(e) => audioEngine.setMasterVolume(Number(e.target.value) / 100)}
        />
        <span className="master-value" aria-hidden="true">
          {percent}%
        </span>
      </div>
      <span className="muted playing-count" data-testid="playing-count">
        {playingCount === 0
          ? 'Nothing playing'
          : `${playingCount} ${playingCount === 1 ? 'sound' : 'sounds'} playing`}
      </span>
      <button
        type="button"
        className="btn danger stop-all"
        aria-keyshortcuts="Escape"
        onClick={() => audioEngine.stopAll()}
      >
        Stop all (Esc)
      </button>
      {engine.error && (
        <div className="message error player-error" role="alert">
          <span>{engine.error}</span>
          <button type="button" className="btn" onClick={() => audioEngine.clearError()}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

type UploadState =
  { kind: 'idle' } | { kind: 'working'; index: number; total: number; name: string }

function UploadPanel({ sounds }: { sounds: Sound[] | null }) {
  const [choice, setChoice] = useState<KindChoice>('auto')
  const [state, setState] = useState<UploadState>({ kind: 'idle' })
  const [errors, setErrors] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const runningRef = useRef(false)
  const cancelledRef = useRef(false)

  // Stop adding files when the view closes.
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  // A file dropped next to the drop zone would make the browser open it and leave the app.
  useEffect(() => {
    const block = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  const ready = sounds !== null
  const busy = state.kind !== 'idle'
  const count = sounds?.length ?? 0
  const full = count >= LIMITS.maxSounds
  const canAdd = ready && !busy && !full

  async function addFiles(list: File[]) {
    if (runningRef.current) return
    if (!ready) {
      setErrors(['Sounds are still loading. Try again in a moment.'])
      return
    }
    const workshopId = workshopStore.getState().currentId
    if (!workshopId) return
    runningRef.current = true
    setErrors([])
    const problems: string[] = []
    let files = list
    if (files.length > MAX_FILES_AT_ONCE) {
      problems.push(`Only the first ${MAX_FILES_AT_ONCE} files were added. Add the rest after.`)
      files = files.slice(0, MAX_FILES_AT_ONCE)
    }
    let added = 0
    try {
      for (let i = 0; i < files.length; i++) {
        if (cancelledRef.current) break
        const file = files[i]
        if (!file) continue
        const label = file.name || 'File'
        setState({ kind: 'working', index: i + 1, total: files.length, name: label })
        const type = await detectAudioType(file)
        if (!type) {
          problems.push(`"${label}" is not an audio file.`)
          continue
        }
        if (file.size === 0) {
          problems.push(`"${label}" is empty.`)
          continue
        }
        if (file.size > MAX_SOUND_BYTES) {
          problems.push(`"${label}" is larger than ${Math.round(MAX_SOUND_BYTES / MB)} MB.`)
          continue
        }
        const blob = new Blob([file], { type })
        let probe: Awaited<ReturnType<typeof audioEngine.probe>>
        try {
          probe = await audioEngine.probe(blob)
        } catch (err) {
          problems.push(
            `"${label}": ${err instanceof DecodeError ? err.message : 'Could not read this file.'}`,
          )
          continue
        }
        if (cancelledRef.current) break
        const kind = pickKind(choice, probe.duration)
        const saved = await workshopStore.getState().addSound(workshopId, {
          name: soundNameFromFile(label),
          kind,
          blob,
          loop: kind === 'music',
          volume: 1,
          hotkey: '',
          color: '',
        })
        if (!saved) {
          // The store shows why. Later files would most likely fail the same way.
          problems.push(`"${label}" was not added.`)
          break
        }
        audioEngine.prime(saved, probe.buffer)
        added++
      }
    } catch (err) {
      console.error(err)
      problems.push('Could not add the sounds.')
    } finally {
      runningRef.current = false
      if (!cancelledRef.current) {
        setState({ kind: 'idle' })
        setErrors(problems)
        // One message for the whole batch instead of the last file's.
        if (added > 1) workshopStore.setState({ notice: `Added ${added} sounds.` })
        if (fileInput.current) fileInput.current.value = ''
      }
    }
  }

  function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    void addFiles(Array.from(files))
  }

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = canAdd ? 'copy' : 'none'
    setDragging(true)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (canAdd) onFiles(e.dataTransfer.files)
  }

  return (
    <section className="sound-upload" aria-labelledby="sound-upload-title">
      <h2 id="sound-upload-title">Upload audio</h2>
      <div className="field">
        <label htmlFor="sound-kind-choice">Add as</label>
        <select
          id="sound-kind-choice"
          value={choice}
          disabled={busy}
          onChange={(e) => setChoice(e.target.value as KindChoice)}
        >
          <option value="auto">Choose by length</option>
          <option value="music">Music</option>
          <option value="sfx">Sound effect</option>
        </select>
      </div>
      <div
        className={`drop-zone${dragging ? ' dragging' : ''}${canAdd ? '' : ' disabled'}`}
        data-testid="sound-drop-zone"
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {state.kind === 'idle' ? (
          <>
            <p>Drop audio files here, or</p>
            <label className={`btn primary file-button${canAdd ? '' : ' disabled'}`}>
              Choose audio files
              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                multiple
                accept={AUDIO_ACCEPT}
                aria-label="Choose audio files"
                disabled={!canAdd}
                onChange={(e) => onFiles(e.target.files)}
              />
            </label>
            <p className="hint muted">
              MP3, WAV, OGG, M4A and more. Up to {Math.round(MAX_SOUND_BYTES / MB)} MB each.
              {choice === 'auto' &&
                ` Sounds of ${MUSIC_MIN_SECONDS} seconds or more are added as music.`}
            </p>
          </>
        ) : (
          <p aria-live="polite" data-testid="sound-upload-status">
            Adding {state.index} of {state.total}: {state.name}
          </p>
        )}
      </div>
      {full && (
        <p className="message warn">
          This workshop has {LIMITS.maxSounds} sounds, the most it can hold. Delete one to add more.
        </p>
      )}
      {errors.length > 0 && (
        <div className="message error" role="alert">
          {errors.length === 1 ? (
            <span>{errors[0]}</span>
          ) : (
            <ul className="upload-errors">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <button type="button" className="btn" onClick={() => setErrors([])}>
            Dismiss
          </button>
        </div>
      )}
    </section>
  )
}

type PadMode = { kind: 'idle' } | { kind: 'edit'; id: string } | { kind: 'delete'; id: string }

/** Where focus goes after an edit or delete: a pad's button, or the file picker when null. */
type FocusRequest = { soundId: string | null; action: 'play' | 'edit' } | null

function PadGrid({ sounds }: { sounds: Sound[] }) {
  const engine = useEngine()
  const [mode, setMode] = useState<PadMode>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState<FocusRequest>(null)
  const gridRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!focus || busy) return
    const active = document.activeElement
    const lost = !active || active === document.body || !!gridRef.current?.contains(active)
    if (lost) {
      if (focus.soundId === null) {
        document.querySelector<HTMLInputElement>('input[aria-label="Choose audio files"]')?.focus()
      } else {
        gridRef.current
          ?.querySelector<HTMLButtonElement>(
            `button[data-sound="${CSS.escape(focus.soundId)}"][data-action="${focus.action}"]`,
          )
          ?.focus()
      }
    }
    setFocus(null)
  }, [focus, busy, sounds])

  if (sounds.length === 0) {
    return (
      <div className="empty">
        <p>No sounds yet. Add music or sound effects to make pads.</p>
      </div>
    )
  }

  async function act(task: () => Promise<boolean>, after: FocusRequest) {
    setBusy(true)
    try {
      const ok = await task()
      if (ok) setMode({ kind: 'idle' })
    } finally {
      setBusy(false)
      setFocus(after)
    }
  }

  function close(soundId: string) {
    setMode({ kind: 'idle' })
    setFocus({ soundId, action: 'edit' })
  }

  const store = workshopStore.getState()

  return (
    <section ref={gridRef} className="pads-section" aria-labelledby="pads-title">
      <h2 id="pads-title">Pads</h2>
      <p className="hint muted">
        Click a pad or press its key to play. Music fades in, and starting other music crossfades.
        Click playing music or a looping effect again to stop it. Press Esc to stop all sound.
      </p>
      <ul className="pads">
        {sounds.map((sound, i) => {
          const padMode = mode.kind !== 'idle' && mode.id === sound.id ? mode.kind : 'idle'
          const next = sounds[i + 1] ?? sounds[i - 1]
          return (
            <Pad
              key={sound.id}
              sound={sound}
              sounds={sounds}
              playing={engine.playing[sound.id] ?? null}
              loading={engine.loading.includes(sound.id)}
              mode={padMode}
              busy={busy}
              onMode={(kind) =>
                kind === 'idle' ? close(sound.id) : setMode({ kind, id: sound.id })
              }
              onSave={(patch) =>
                act(() => store.updateSound(sound.id, patch), {
                  soundId: sound.id,
                  action: 'edit',
                })
              }
              onDelete={() =>
                act(() => store.deleteSound(sound.id), {
                  soundId: next?.id ?? null,
                  action: 'play',
                })
              }
            />
          )
        })}
      </ul>
    </section>
  )
}

interface PadProps {
  sound: Sound
  sounds: Sound[]
  playing: PlayingInfo | null
  loading: boolean
  mode: 'idle' | 'edit' | 'delete'
  busy: boolean
  onMode: (mode: 'idle' | 'edit' | 'delete') => void
  onSave: (patch: SoundSettings) => Promise<void>
  onDelete: () => Promise<void>
}

function Pad({ sound, sounds, playing, loading, mode, busy, onMode, onSave, onDelete }: PadProps) {
  const stateId = useId()
  const hotkey = normalizeHotkey(sound.hotkey)
  const state = playing ? (playing.stopping ? 'Stopping' : 'Playing') : loading ? 'Loading...' : ''
  const style = sound.color ? ({ '--pad-color': sound.color } as CSSProperties) : undefined
  return (
    <li
      className={`pad-card kind-${sound.kind}${playing && !playing.stopping ? ' playing' : ''}${mode === 'idle' ? '' : ' open'}`}
      style={style}
      data-testid="pad"
      data-playing={playing && !playing.stopping ? 'true' : 'false'}
    >
      <button
        type="button"
        className="pad"
        aria-label={`Play ${sound.name}`}
        aria-keyshortcuts={hotkey ? hotkeyLabel(hotkey) : undefined}
        aria-describedby={state ? stateId : undefined}
        data-sound={sound.id}
        data-action="play"
        onClick={() => void audioEngine.play(sound.id, { toggle: true })}
      >
        <span className="pad-name">{sound.name}</span>
        <span className="pad-meta">
          {KIND_NAMES[sound.kind]}
          {sound.loop ? ', loops' : ''}
          {sound.volume < 1 ? `, ${Math.round(sound.volume * 100)}%` : ''}
        </span>
        {hotkey && (
          <kbd className="pad-key" aria-hidden="true">
            {hotkeyLabel(hotkey)}
          </kbd>
        )}
        <span className="pad-state" id={stateId} data-testid="pad-state">
          {state}
        </span>
        {playing && <PadProgress info={playing} />}
      </button>
      <div className="pad-actions">
        <button
          type="button"
          className="btn"
          aria-label={`Edit ${sound.name}`}
          data-sound={sound.id}
          data-action="edit"
          disabled={busy}
          onClick={() => onMode('edit')}
        >
          Edit
        </button>
        <button
          type="button"
          className="btn"
          aria-label={`Delete ${sound.name}`}
          disabled={busy}
          onClick={() => onMode('delete')}
        >
          Delete
        </button>
      </div>
      {mode === 'edit' && (
        <SoundForm
          sound={sound}
          sounds={sounds}
          busy={busy}
          onSave={onSave}
          onCancel={() => onMode('idle')}
        />
      )}
      {mode === 'delete' && (
        <div
          className="message error inline-form"
          role="group"
          aria-label={`Confirm delete sound ${sound.name}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onMode('idle')
          }}
        >
          <span>Delete "{sound.name}"? This cannot be undone.</span>
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={() => void onDelete()}
          >
            Delete sound
          </button>
          <button type="button" className="btn" autoFocus onClick={() => onMode('idle')}>
            Cancel
          </button>
        </div>
      )}
    </li>
  )
}

/** A bar that shows how far the sound has played. It draws itself without React renders. */
function PadProgress({ info }: { info: PlayingInfo }) {
  const fill = useRef<HTMLSpanElement>(null)
  const time = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let frame = 0
    function draw() {
      const elapsed = Math.max(0, audioEngine.now() - info.startedAt)
      const d = info.duration > 0 ? info.duration : 1
      const pos = info.loop ? elapsed % d : Math.min(elapsed, d)
      if (fill.current) fill.current.style.width = `${(pos / d) * 100}%`
      if (time.current) time.current.textContent = `${formatSeconds(pos)} / ${formatSeconds(d)}`
      frame = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [info.startedAt, info.duration, info.loop])

  return (
    <>
      <span className="pad-time" ref={time} aria-hidden="true" />
      <span className="pad-progress" aria-hidden="true">
        <span className="pad-progress-fill" ref={fill} />
      </span>
    </>
  )
}

type SoundSettings = Pick<Sound, 'name' | 'kind' | 'loop' | 'volume' | 'hotkey' | 'color'>

function SoundForm({
  sound,
  sounds,
  busy,
  onSave,
  onCancel,
}: {
  sound: Sound
  sounds: Sound[]
  busy: boolean
  onSave: (patch: SoundSettings) => Promise<void>
  onCancel: () => void
}) {
  const id = useId()
  const [name, setName] = useState(sound.name)
  const [kind, setKind] = useState<SoundKind>(sound.kind)
  const [loop, setLoop] = useState(sound.loop)
  const [volume, setVolume] = useState(Math.round(sound.volume * 100))
  const [hotkey, setHotkey] = useState(normalizeHotkey(sound.hotkey))
  const [color, setColor] = useState(sound.color)

  const hotkeyError = hotkeyProblem(hotkey, sounds, sound.id)
  const nameTaken = sounds.some((s) => s.id !== sound.id && soundKey(s.name) === soundKey(name))
  const nameError = !name.trim()
    ? 'Give the sound a name.'
    : nameTaken
      ? 'Another sound has this name.'
      : null
  const colors = SOUND_COLORS.some((c) => c.value === color)
    ? SOUND_COLORS
    : [...SOUND_COLORS, { label: `Custom (${color})`, value: color }]

  function submit(e: FormEvent) {
    e.preventDefault()
    if (hotkeyError || nameError) return
    void onSave({ name: name.trim(), kind, loop, volume: volume / 100, hotkey, color })
  }

  function onHotkeyKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      onCancel()
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab' || e.key === 'Enter') return
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      setHotkey('')
      return
    }
    if (e.key.length === 1) {
      e.preventDefault()
      setHotkey(e.key === ' ' ? ' ' : e.key.toLowerCase())
    }
  }

  return (
    <form className="sound-form" aria-label={`Edit sound ${sound.name}`} onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${id}-name`}>Sound name</label>
        <input
          id={`${id}-name`}
          type="text"
          value={name}
          maxLength={LIMITS.maxTitleLength}
          autoFocus
          aria-invalid={nameError ? 'true' : undefined}
          aria-describedby={nameError ? `${id}-name-error` : undefined}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
          }}
        />
        {nameError && (
          <span id={`${id}-name-error`} className="field-error">
            {nameError}
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor={`${id}-kind`}>Sound kind</label>
        <select
          id={`${id}-kind`}
          value={kind}
          onChange={(e) => setKind(e.target.value as SoundKind)}
        >
          {SOUND_KINDS.map((k) => (
            <option key={k} value={k}>
              {k === 'music' ? 'Music' : 'Sound effect'}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-color`}>Sound color</label>
        <select id={`${id}-color`} value={color} onChange={(e) => setColor(e.target.value)}>
          {colors.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-hotkey`}>Hotkey</label>
        <input
          id={`${id}-hotkey`}
          className="hotkey-input"
          type="text"
          value={hotkey === ' ' ? 'Space' : hotkeyLabel(hotkey)}
          placeholder="None"
          aria-invalid={hotkeyError ? 'true' : undefined}
          aria-describedby={`${id}-hotkey-help`}
          onKeyDown={onHotkeyKeyDown}
          onChange={(e) => {
            // Typing is handled on key down. This covers paste and other input.
            const v = e.target.value.trim()
            setHotkey(v ? (v[v.length - 1] ?? '').toLowerCase() : '')
          }}
        />
        <span id={`${id}-hotkey-help`} className={hotkeyError ? 'field-error' : 'hint muted'}>
          {hotkeyError ?? 'Press a key. Backspace clears it.'}
        </span>
      </div>
      <div className="field">
        <label htmlFor={`${id}-volume`}>Volume</label>
        <span className="volume-row">
          <input
            id={`${id}-volume`}
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume}
            aria-valuetext={`${volume}%`}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
          <span aria-hidden="true">{volume}%</span>
        </span>
      </div>
      <label className="check">
        <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
        Loop
      </label>
      <div className="inline-form">
        <button
          type="submit"
          className="btn primary"
          disabled={busy || !!hotkeyError || !!nameError}
        >
          Save sound
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
