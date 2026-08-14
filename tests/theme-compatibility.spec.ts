import { afterEach, describe, expect, it } from 'vitest'
import { ThemeCompatibility } from '../src/theme-compatibility.ts'

const compatibility = new ThemeCompatibility()

afterEach(() => {
  document.body.innerHTML = ''
})

function element(markup = '<div></div>'): HTMLElement {
  document.body.innerHTML = markup
  return document.body.firstElementChild as HTMLElement
}

describe('ThemeCompatibility', () => {
  it('rejects hidden, invisible, and measurement surfaces', () => {
    expect(compatibility.canAnimate(element('<div hidden></div>'), 'menu')).toBe(false)
    expect(compatibility.canAnimate(element('<div aria-hidden="true"></div>'), 'menu')).toBe(false)
    expect(compatibility.canAnimate(element('<div style="display:none"></div>'), 'menu')).toBe(false)
    expect(compatibility.canAnimate(element('<div style="visibility:hidden"></div>'), 'menu')).toBe(false)
    expect(compatibility.canAnimate(element('<div data-measuring></div>'), 'menu')).toBe(false)
    expect(compatibility.canAnimate(element('<div data-phase="settling"></div>'), 'page')).toBe(false)
  })

  it('allows an aria-hidden visual mask when it is otherwise visible', () => {
    expect(compatibility.canAnimate(element('<div aria-hidden="true"></div>'), 'mask')).toBe(true)
  })

  it('honors explicit opt-out on the element or an ancestor', () => {
    const child = element('<div data-dsh-motion="off"><div id="child"></div></div>')
      .querySelector<HTMLElement>('#child') as HTMLElement
    expect(compatibility.canAnimate(child, 'slot')).toBe(false)
  })

  it('rejects host WAAPI and CSS animations but ignores runtime-owned animations', () => {
    const target = element()
    const hostAnimation = { playState: 'running' }
    Object.defineProperty(target, 'getAnimations', { value: () => [hostAnimation] })
    expect(compatibility.canAnimate(target, 'menu')).toBe(false)
    expect(compatibility.canAnimate(target, 'menu', new Set([hostAnimation]))).toBe(true)

    const cssAnimated = element('<div style="animation-name: host-enter"></div>')
    expect(compatibility.canAnimate(cssAnimated, 'menu')).toBe(false)
  })

  it('does not replace a host-owned state color transition', () => {
    const target = element(`
      <button style="transition-property: color; transition-duration: 180ms"></button>
    `)
    expect(compatibility.canAnimate(target, 'tab')).toBe(false)
  })

  it('excludes streaming, composer, trajectory, tooltip, toast, and parallax roots', () => {
    const cases = [
      '<div data-chat-flow><div id="x"></div></div>',
      '<div data-composer-seat><div id="x"></div></div>',
      '<div data-trajectory-scroll><div id="x"></div></div>',
      '<div role="tooltip" id="x"></div>',
      '<div role="alert" id="x"></div>',
      '<div data-dsh-angelina-layer="background"><div id="x"></div></div>',
    ]
    for (const markup of cases) {
      const root = element(markup)
      const target = (root.id === 'x' ? root : root.querySelector('#x')) as HTMLElement
      expect(compatibility.canAnimate(target, 'slot')).toBe(false)
    }
  })

  it('skips sidebar slot motion while allowing its fixed settings dialog', () => {
    const root = element(`
      <div data-slot="sidebar">
        <div id="slot" data-slot="sidebar.workspaces.item"></div>
        <div id="dialog" role="dialog">
          <div id="settings-slot" data-slot="settings.section"></div>
        </div>
      </div>
    `)
    expect(compatibility.canAnimate(root.querySelector('#slot') as HTMLElement, 'slot')).toBe(false)
    expect(compatibility.canAnimate(root.querySelector('#dialog') as HTMLElement, 'dialog')).toBe(true)
    expect(compatibility.canAnimate(root.querySelector('#settings-slot') as HTMLElement, 'slot')).toBe(true)
  })

  it('does not treat Angelina parallax ownership on body as a global opt-out', () => {
    document.body.setAttribute('data-dsh-angelina-parallax', '')
    const target = element('<div role="menu"></div>')
    expect(compatibility.canAnimate(target, 'menu')).toBe(true)
    document.body.removeAttribute('data-dsh-angelina-parallax')
  })
})
