import {
  AUDIENCE_WINDOW_FEATURES,
  AUDIENCE_WINDOW_NAME,
  openAudienceWindow,
  resetAudienceWindow,
} from './popup'

afterEach(() => {
  resetAudienceWindow()
  vi.restoreAllMocks()
})

function fakeWindow(pathname: string | (() => string)) {
  const replace = vi.fn()
  const focus = vi.fn()
  const location = {
    get pathname() {
      return typeof pathname === 'function' ? pathname() : pathname
    },
    replace,
  }
  const win = { closed: false, focus, location } as unknown as Window
  return { win, replace, focus }
}

test('opens a new window and loads the audience page into it', () => {
  const { win, replace } = fakeWindow('blank')
  const open = vi.fn(() => win)
  expect(openAudienceWindow(open)).toBe('opened')
  expect(open).toHaveBeenCalledWith('', AUDIENCE_WINDOW_NAME, AUDIENCE_WINDOW_FEATURES)
  expect(replace).toHaveBeenCalledWith('/audience.html')
})

test('finds an audience window that is already open without loading it again', () => {
  // The control window was reloaded, so it no longer holds the popup it opened before.
  const { win, replace, focus } = fakeWindow('/audience.html')
  const open = vi.fn(() => win)
  expect(openAudienceWindow(open)).toBe('focused')
  expect(replace).not.toHaveBeenCalled()
  expect(focus).toHaveBeenCalled()
  // The next click uses the remembered window.
  expect(openAudienceWindow(open)).toBe('focused')
  expect(open).toHaveBeenCalledTimes(1)
})

test('reports a blocked popup', () => {
  expect(openAudienceWindow(() => null)).toBe('blocked')
  const closed = { closed: true } as unknown as Window
  expect(openAudienceWindow(() => closed)).toBe('blocked')
  expect(
    openAudienceWindow(() => {
      throw new Error('nope')
    }),
  ).toBe('blocked')
})

test('opens by URL when the found window cannot be read or moved', () => {
  const { win: odd } = fakeWindow(() => {
    throw new Error('cross origin')
  })
  vi.mocked(odd.location.replace).mockImplementation(() => {
    throw new Error('cannot navigate')
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { win: good } = fakeWindow('/audience.html')
  const open = vi.fn((url: string) => (url === '' ? odd : good))
  expect(openAudienceWindow(open)).toBe('opened')
  expect(open).toHaveBeenLastCalledWith(
    '/audience.html',
    AUDIENCE_WINDOW_NAME,
    AUDIENCE_WINDOW_FEATURES,
  )
})

test('opens again after the remembered window was closed', () => {
  const first = fakeWindow('blank')
  expect(openAudienceWindow(() => first.win)).toBe('opened')
  ;(first.win as { closed: boolean }).closed = true
  const second = fakeWindow('blank')
  expect(openAudienceWindow(() => second.win)).toBe('opened')
  expect(second.replace).toHaveBeenCalled()
})
