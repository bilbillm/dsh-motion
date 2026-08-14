import { afterEach, describe, expect, it, vi } from 'vitest'
import { MotionPolicy } from '../src/motion-policy.ts'
import { MotionRuntime } from '../src/motion-runtime.ts'
import type { MotionAnimation, MotionAnimator } from '../src/motion-runtime.ts'
import { mutableMediaQuery, mutationTurn } from './helpers.ts'

interface AnimationCall {
  readonly element: HTMLElement
  readonly keyframes: Keyframe[]
  readonly options: KeyframeAnimationOptions
  readonly animation: MotionAnimation
}

function runtimeFixture(policy?: MotionPolicy) {
  let nextFrame = 0
  const frames = new Map<number, () => void>()
  const calls: AnimationCall[] = []
  const animator: MotionAnimator = (element, keyframes, options) => {
    const animation: MotionAnimation = { cancel: vi.fn() }
    calls.push({ element, keyframes, options, animation })
    return animation
  }
  const runtime = new MotionRuntime({
    root: document,
    ...(policy === undefined ? {} : { policy }),
    animator,
    requestFrame: (callback) => {
      nextFrame += 1
      frames.set(nextFrame, callback)
      return nextFrame
    },
    cancelFrame: (handle) => { frames.delete(handle) },
  })
  runtime.start()
  return { runtime, calls, frames }
}

afterEach(() => {
  document.body.innerHTML = ''
  for (const style of document.querySelectorAll('[data-dsh-motion-style]')) style.remove()
  vi.restoreAllMocks()
})

describe('MotionRuntime', () => {
  it('animates a newly mounted semantic node once', async () => {
    const { runtime, calls } = runtimeFixture()
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    document.body.appendChild(menu)
    await mutationTurn()
    runtime.flushNow()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.element).toBe(menu)
    expect(calls[0]?.options.duration).toBeGreaterThanOrEqual(120)

    menu.appendChild(document.createElement('span'))
    await mutationTurn()
    runtime.flushNow()
    document.body.appendChild(menu)
    await mutationTurn()
    runtime.flushNow()
    expect(calls).toHaveLength(1)
    runtime.dispose()
  })

  it('coalesces consecutive page state changes into one frame', async () => {
    const { runtime, calls } = runtimeFixture()
    const page = document.createElement('main')
    page.setAttribute('data-phase', 'hero')
    page.innerHTML = '<div data-conversation-scroll></div>'
    document.body.appendChild(page)
    page.setAttribute('data-phase', 'settling')
    page.setAttribute('data-phase', 'active')
    await mutationTurn()
    runtime.flushNow()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.element).toBe(page)
    runtime.dispose()
  })

  it('skips host-animated and opted-out surfaces', async () => {
    const { runtime, calls } = runtimeFixture()
    const hostAnimated = document.createElement('div')
    hostAnimated.setAttribute('role', 'menu')
    Object.defineProperty(hostAnimated, 'getAnimations', {
      value: () => [{ playState: 'running' }],
    })
    const optedOut = document.createElement('section')
    optedOut.setAttribute('data-dsh-motion', 'off')
    optedOut.innerHTML = '<div role="listbox"></div>'
    document.body.append(hostAnimated, optedOut)
    await mutationTurn()
    runtime.flushNow()
    expect(calls).toEqual([])
    runtime.dispose()
  })

  it('preserves focus, ARIA state, scroll position, and layout readings', async () => {
    const { runtime, calls } = runtimeFixture()
    const scroll = document.createElement('div')
    scroll.scrollTop = 37
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', 'Actions')
    const button = document.createElement('button')
    button.textContent = 'Run'
    menu.appendChild(button)
    Object.defineProperty(menu, 'getBoundingClientRect', {
      value: () => ({ width: 240, height: 120, top: 1, left: 2, right: 242, bottom: 121, x: 2, y: 1, toJSON: () => ({}) }),
    })
    scroll.appendChild(menu)
    document.body.appendChild(scroll)
    button.focus()
    const before = menu.getBoundingClientRect()
    await mutationTurn()
    runtime.flushNow()

    expect(calls).toHaveLength(1)
    expect(document.activeElement).toBe(button)
    expect(menu.getAttribute('aria-label')).toBe('Actions')
    expect(scroll.scrollTop).toBe(37)
    const after = menu.getBoundingClientRect()
    expect([after.width, after.height, after.top, after.left]).toEqual([
      before.width, before.height, before.top, before.left,
    ])
    runtime.dispose()
  })

  it('does not start WAAPI in reduced motion and cancels active motion on a live change', async () => {
    const media = mutableMediaQuery(true)
    const policy = new MotionPolicy({ tokenSource: document.documentElement, mediaQuery: media.query })
    const { runtime, calls } = runtimeFixture(policy)

    const first = document.createElement('div')
    first.setAttribute('role', 'menu')
    document.body.appendChild(first)
    await mutationTurn()
    runtime.flushNow()
    expect(calls).toHaveLength(0)

    media.setMatches(false)
    const second = document.createElement('div')
    second.setAttribute('role', 'menu')
    document.body.appendChild(second)
    await mutationTurn()
    runtime.flushNow()
    expect(calls).toHaveLength(1)
    expect(runtime.activeAnimationCount()).toBe(1)

    media.setMatches(true)
    expect(calls[0]?.animation.cancel).toHaveBeenCalledOnce()
    expect(runtime.activeAnimationCount()).toBe(0)
    runtime.dispose()
    policy.dispose()
  })

  it('adds state-only transitions without taking over transform', async () => {
    const { runtime, calls } = runtimeFixture()
    const tab = document.createElement('button')
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', 'false')
    tab.style.transform = 'translateX(10px)'
    document.body.appendChild(tab)
    await mutationTurn()
    runtime.flushNow()
    expect(tab.getAttribute('data-dsh-motion-state')).toBe('on')
    expect(tab.style.transform).toBe('translateX(10px)')
    expect(calls).toEqual([])

    tab.setAttribute('aria-selected', 'true')
    await mutationTurn()
    runtime.flushNow()
    expect(tab.getAttribute('aria-selected')).toBe('true')
    expect(calls).toEqual([])
    runtime.dispose()
    expect(tab.hasAttribute('data-dsh-motion-state')).toBe(false)
  })

  it('seeds state transitions for controls already present at installation', () => {
    const tab = document.createElement('button')
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', 'true')
    document.body.appendChild(tab)
    const { runtime, calls } = runtimeFixture()
    runtime.flushNow()
    expect(tab.getAttribute('data-dsh-motion-state')).toBe('on')
    expect(calls).toEqual([])
    runtime.dispose()
  })

  it('disconnects, cancels, removes styles, and restores markers on unload', async () => {
    const { runtime, calls } = runtimeFixture()
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    const toggle = document.createElement('button')
    toggle.setAttribute('role', 'switch')
    toggle.setAttribute('aria-checked', 'false')
    document.body.append(menu, toggle)
    await mutationTurn()
    runtime.flushNow()
    expect(document.querySelector('[data-dsh-motion-style]')).not.toBeNull()
    expect(toggle.getAttribute('data-dsh-motion-state')).toBe('on')

    runtime.dispose()
    expect(calls[0]?.animation.cancel).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-dsh-motion-style]')).toBeNull()
    expect(toggle.hasAttribute('data-dsh-motion-state')).toBe(false)

    const later = document.createElement('div')
    later.setAttribute('role', 'menu')
    document.body.appendChild(later)
    await mutationTurn()
    runtime.flushNow()
    expect(calls).toHaveLength(1)
  })

  it('does not retain state controls after their subtree is removed', async () => {
    const { runtime } = runtimeFixture()
    const tab = document.createElement('button')
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', 'true')
    document.body.appendChild(tab)
    await mutationTurn()
    runtime.flushNow()
    expect(tab.getAttribute('data-dsh-motion-state')).toBe('on')

    tab.remove()
    await mutationTurn()
    tab.setAttribute('data-dsh-motion-state', 'detached-owner')
    runtime.dispose()
    expect(tab.getAttribute('data-dsh-motion-state')).toBe('detached-owner')
  })

  it('has no polling or persistent animation-frame loop', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    const { runtime, frames } = runtimeFixture()
    expect(frames.size).toBe(0)
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    document.body.appendChild(menu)
    await mutationTurn()
    expect(frames.size).toBe(1)
    runtime.flushNow()
    expect(frames.size).toBe(0)
    expect(interval).not.toHaveBeenCalled()
    runtime.dispose()
  })
})
