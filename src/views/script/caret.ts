// Where the caret of a textarea is on screen, so the cue suggestions can open next to it.
// Uses a hidden copy of the textarea with the same text styles.

const COPIED = [
  'boxSizing',
  'width',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontSize',
  'lineHeight',
  'fontFamily',
  'letterSpacing',
  'tabSize',
  'textIndent',
  'textTransform',
  'wordSpacing',
] as const

/** Caret position inside the textarea box, in pixels, below the caret line. */
export function caretPosition(el: HTMLTextAreaElement, position: number): { x: number; y: number } {
  try {
    const style = window.getComputedStyle(el)
    const mirror = document.createElement('div')
    for (const key of COPIED) mirror.style[key] = style[key]
    mirror.style.position = 'absolute'
    mirror.style.visibility = 'hidden'
    mirror.style.top = '0'
    mirror.style.left = '-9999px'
    mirror.style.whiteSpace = 'pre-wrap'
    mirror.style.overflowWrap = 'break-word'
    mirror.style.overflow = 'hidden'
    mirror.textContent = el.value.slice(0, position)
    const marker = document.createElement('span')
    marker.textContent = el.value.slice(position, position + 1) || '.'
    mirror.appendChild(marker)
    document.body.appendChild(mirror)
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3 || 20
    const x = marker.offsetLeft - el.scrollLeft
    const y = marker.offsetTop - el.scrollTop + lineHeight
    mirror.remove()
    const maxY = el.clientHeight || y
    return {
      x: Math.max(0, Math.min(x, (el.clientWidth || x) - 40)),
      y: Math.max(0, Math.min(y, maxY)),
    }
  } catch {
    return { x: 0, y: 0 }
  }
}
