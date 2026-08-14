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

function runtimeFixture(
  policy?: MotionPolicy,
  animationFactory: () => MotionAnimation = () => ({ cancel: vi.fn() }),
) {
  let nextFrame = 0
  const frames = new Map<number, () => void>()
  const calls: AnimationCall[] = []
  const animator: MotionAnimator = (element, keyframes, options) => {
    const animation = animationFactory()
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

  it('keeps an inert visual ghost long enough to animate a removed menu out', async () => {
    const { runtime, calls } = runtimeFixture()
    const menu = document.createElement('div')
    menu.id = 'menu-id'
    menu.setAttribute('role', 'menu')
    menu.innerHTML = '<button id="action" style="pointer-events: auto; backdrop-filter: blur(4px)">Run</button>'
    document.body.appendChild(menu)
    await mutationTurn()
    runtime.flushNow()

    menu.remove()
    await mutationTurn()
    runtime.flushNow()

    const ghost = document.querySelector<HTMLElement>('[data-dsh-motion-ghost]')
    expect(ghost).not.toBeNull()
    expect(ghost?.getAttribute('aria-hidden')).toBe('true')
    expect(ghost?.hasAttribute('inert')).toBe(true)
    expect(ghost?.querySelector('[id]')).toBeNull()
    expect(ghost?.querySelector<HTMLElement>('button')?.style.pointerEvents).toBe('none')
    expect(ghost?.querySelector<HTMLElement>('button')?.style.getPropertyValue('backdrop-filter')).toBe('none')
    expect(calls).toHaveLength(2)
    expect(calls[1]?.keyframes).toMatchObject([{ opacity: 1 }, { opacity: 0 }])

    runtime.dispose()
    expect(document.querySelector('[data-dsh-motion-ghost]')).toBeNull()
  })

  it('freezes a glass dialog backdrop only while its entry animation is active', async () => {
    let finish: (() => void) | undefined
    const finished = new Promise<void>((resolve) => { finish = resolve })
    const { runtime, calls } = runtimeFixture(undefined, () => ({ cancel: vi.fn(), finished }))
    const dialog = document.createElement('section')
    dialog.setAttribute('role', 'dialog')
    dialog.style.setProperty('backdrop-filter', 'blur(12px) saturate(1.18)')
    document.body.appendChild(dialog)
    await mutationTurn()
    runtime.flushNow()

    expect(calls).toHaveLength(1)
    expect(dialog.style.getPropertyValue('backdrop-filter')).toBe('none')
    finish?.()
    await finished
    await Promise.resolve()
    expect(dialog.style.getPropertyValue('backdrop-filter')).toBe('blur(12px) saturate(1.18)')
    runtime.dispose()
  })

  it('animates model, permission, and command surfaces inside composer ownership', async () => {
    const { runtime, calls } = runtimeFixture()
    const composer = document.createElement('div')
    composer.setAttribute('data-composer-card', '')
    composer.innerHTML = `
      <div id="model" role="menu"></div>
      <div id="permission" role="menu"></div>
      <div data-slot="conversation.input.overlay"><div id="commands" role="listbox"></div></div>
    `
    document.body.appendChild(composer)
    await mutationTurn()
    runtime.flushNow()
    expect(calls.map(call => call.element.id)).toEqual(['model', 'permission', 'commands'])
    runtime.dispose()
  })

  it('crossfades drill-in menu cards when one semantic page replaces another', async () => {
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', 'Model and reasoning')
    menu.innerHTML = `
      <button role="menuitem">Model</button>
      <button role="menuitem">Reasoning</button>
    `
    document.body.appendChild(menu)
    const { runtime, calls } = runtimeFixture()

    menu.replaceChildren()
    const model = document.createElement('button')
    model.setAttribute('role', 'menuitemradio')
    model.textContent = 'DeepSeek V4'
    menu.appendChild(model)
    await mutationTurn()
    runtime.flushNow()

    const ghost = document.querySelector<HTMLElement>('[data-dsh-motion-menu-page-ghost]')
    expect(ghost?.textContent).toContain('Reasoning')
    expect(ghost?.getAttribute('aria-hidden')).toBe('true')
    expect(calls.map(call => call.element)).toContain(menu)
    expect(calls.some(call => call.element === ghost && call.keyframes[1]?.opacity === 0)).toBe(true)
    expect(calls.some(call => call.element === menu && call.keyframes[0]?.opacity === 0)).toBe(true)

    runtime.dispose()
    expect(document.querySelector('[data-dsh-motion-menu-page-ghost]')).toBeNull()
  })

  it('does not animate listbox option filtering as a card replacement', async () => {
    const listbox = document.createElement('div')
    listbox.setAttribute('role', 'listbox')
    listbox.innerHTML = '<div role="option">Plan</div>'
    document.body.appendChild(listbox)
    const { runtime, calls } = runtimeFixture()

    listbox.replaceChildren()
    const option = document.createElement('div')
    option.setAttribute('role', 'option')
    option.textContent = 'Permission'
    listbox.appendChild(option)
    await mutationTurn()
    runtime.flushNow()

    expect(calls).toHaveLength(0)
    expect(document.querySelector('[data-dsh-motion-menu-page-ghost]')).toBeNull()
    runtime.dispose()
  })

  it('pairs dialog and mask exit motion in one inaccessible overlay ghost', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Settings'
    const overlay = document.createElement('div')
    overlay.setAttribute('role', 'presentation')
    overlay.innerHTML = `
      <div aria-hidden="true"></div>
      <section role="dialog" aria-modal="true"><button>Close</button></section>
    `
    document.body.append(trigger, overlay)
    const { runtime, calls } = runtimeFixture()
    trigger.focus()

    overlay.remove()
    await mutationTurn()
    runtime.flushNow()

    const ghost = document.querySelector<HTMLElement>('[data-dsh-motion-ghost]')
    expect(ghost?.getAttribute('role')).toBe('presentation')
    expect(ghost?.getAttribute('aria-hidden')).toBe('true')
    expect(document.activeElement).toBe(trigger)
    expect(calls.map(call => call.element.getAttribute('role') ?? 'mask')).toEqual(['dialog', 'mask'])
    runtime.dispose()
  })

  it('animates workspace disclosure height and preserves removed rows as fading ghosts', async () => {
    const slot = document.createElement('div')
    slot.setAttribute('data-slot', 'sidebar.workspaces')
    const tree = document.createElement('div')
    tree.setAttribute('role', 'tree')
    const section = document.createElement('div')
    const header = document.createElement('span')
    const workspace = document.createElement('div')
    workspace.setAttribute('role', 'treeitem')
    workspace.setAttribute('aria-expanded', 'true')
    const session = document.createElement('div')
    session.setAttribute('role', 'treeitem')
    session.textContent = 'New Session'
    header.appendChild(workspace)
    section.append(header, session)
    tree.appendChild(section)
    slot.appendChild(tree)
    document.body.appendChild(slot)
    Object.defineProperty(section, 'getBoundingClientRect', {
      value: () => ({
        width: 240,
        height: workspace.getAttribute('aria-expanded') === 'true' ? 66 : 34,
        top: 0,
        left: 0,
        right: 240,
        bottom: workspace.getAttribute('aria-expanded') === 'true' ? 66 : 34,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })
    Object.defineProperty(session, 'getBoundingClientRect', {
      value: () => ({
        width: 220, height: 32, top: 34, left: 8, right: 228, bottom: 66,
        x: 8, y: 34, toJSON: () => ({}),
      }),
    })
    const { runtime, calls } = runtimeFixture()
    Object.defineProperty(workspace, 'getAnimations', {
      value: () => [{ playState: 'running' }],
    })

    workspace.setAttribute('aria-expanded', 'false')
    session.remove()
    await mutationTurn()
    runtime.flushNow()

    expect(calls.some(call => call.element === section
      && call.keyframes[0]?.height === '66px'
      && call.keyframes[1]?.height === '34px')).toBe(true)
    expect(document.querySelector('[data-dsh-motion-disclosure-ghost]')?.textContent).toBe('New Session')
    expect(calls.some(call => call.element.hasAttribute('data-dsh-motion-disclosure-ghost')
      && call.keyframes[1]?.opacity === 0)).toBe(true)

    const nextSession = document.createElement('div')
    nextSession.setAttribute('role', 'treeitem')
    nextSession.textContent = 'New Session'
    Object.defineProperty(nextSession, 'getBoundingClientRect', {
      value: () => ({
        width: 220, height: 32, top: 34, left: 8, right: 228, bottom: 66,
        x: 8, y: 34, toJSON: () => ({}),
      }),
    })
    workspace.setAttribute('aria-expanded', 'true')
    section.appendChild(nextSession)
    await mutationTurn()
    runtime.flushNow()
    expect(calls.some(call => call.element === section
      && call.keyframes[0]?.height === '34px'
      && call.keyframes[1]?.height === '66px')).toBe(true)
    expect(document.querySelector('[data-dsh-motion-disclosure-ghost]')).toBeNull()
    runtime.dispose()
  })

  it('does not manufacture exit ghosts while reduced motion is enabled', async () => {
    const media = mutableMediaQuery(true)
    const policy = new MotionPolicy({ tokenSource: document.documentElement, mediaQuery: media.query })
    const { runtime, calls } = runtimeFixture(policy)
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    menu.innerHTML = '<button role="menuitem">Model</button>'
    document.body.appendChild(menu)
    await mutationTurn()
    runtime.flushNow()
    menu.innerHTML = '<button role="menuitemradio">DeepSeek V4</button>'
    await mutationTurn()
    runtime.flushNow()
    expect(document.querySelector('[data-dsh-motion-menu-page-ghost]')).toBeNull()
    menu.remove()
    await mutationTurn()
    runtime.flushNow()
    expect(calls).toEqual([])
    expect(document.querySelector('[data-dsh-motion-ghost]')).toBeNull()
    runtime.dispose()
    policy.dispose()
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
