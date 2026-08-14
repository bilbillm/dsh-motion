import { afterEach, describe, expect, it } from 'vitest'
import { SurfaceClassifier } from '../src/surface-classifier.ts'

const classifier = new SurfaceClassifier()

afterEach(() => {
  document.body.innerHTML = ''
})

function mount(markup: string): HTMLElement {
  document.body.innerHTML = markup
  return document.body.firstElementChild as HTMLElement
}

describe('SurfaceClassifier', () => {
  it('classifies menus, submenus, and listboxes independently', () => {
    const root = mount(`
      <div>
        <div role="menu"><div role="menu"></div></div>
        <div role="listbox"></div>
      </div>
    `)
    expect(classifier.classifySubtree(root).map(item => item.kind)).toEqual([
      'menu', 'menu', 'listbox',
    ])
  })

  it('pairs a direct aria-hidden mask with its dialog', () => {
    const root = mount(`
      <div role="presentation">
        <div id="mask" aria-hidden="true"></div>
        <section id="panel" role="dialog" aria-modal="true"></section>
      </div>
    `)
    const intents = classifier.classifySubtree(root)
    expect(intents.map(item => [item.kind, item.element.id])).toEqual([
      ['dialog', 'panel'],
      ['mask', 'mask'],
    ])
    expect(intents[0]?.related).toBe(document.querySelector('#mask'))
    expect(intents[1]?.related).toBe(document.querySelector('#panel'))
  })

  it('does not treat an unrelated nested aria-hidden node as a dialog mask', () => {
    const root = mount(`
      <div><div aria-hidden="true"><span></span></div><div role="dialog"></div></div>
    `)
    expect(classifier.classifySubtree(root).map(item => item.kind)).toEqual(['dialog'])
  })

  it('classifies tab panels when visible and after hidden is removed', () => {
    const panel = mount('<div role="tabpanel" hidden>Panel</div>')
    expect(classifier.classifySubtree(panel)).toEqual([])
    panel.hidden = false
    expect(classifier.classifyAttribute(panel, 'hidden', '')).toMatchObject([
      { kind: 'tabpanel', trigger: 'visibility' },
    ])
  })

  it('classifies tab and switch mounts plus their state changes', () => {
    const root = mount(`
      <div>
        <button role="tab" aria-selected="false"></button>
        <button role="switch" aria-checked="false"></button>
      </div>
    `)
    expect(classifier.classifySubtree(root).map(item => item.kind)).toEqual(['tab', 'switch'])
    const tab = root.querySelector<HTMLElement>('[role="tab"]') as HTMLElement
    tab.setAttribute('aria-selected', 'true')
    expect(classifier.classifyAttribute(tab, 'aria-selected', 'false')).toMatchObject([
      { kind: 'tab', trigger: 'state', state: 'aria-selected=true' },
    ])
  })

  it('recognizes the conversation page but not nested composer phases', () => {
    const root = mount(`
      <div data-ds-conversation-column>
        <main data-phase="active"><div data-conversation-scroll></div></main>
        <div data-composer-seat><textarea data-phase="inert"></textarea></div>
      </div>
    `)
    const intents = classifier.classifySubtree(root)
    expect(intents.filter(item => item.kind === 'page')).toHaveLength(1)
    expect(intents.find(item => item.kind === 'page')?.element.tagName).toBe('MAIN')
  })

  it('allows semantic menus and listboxes inside the composer without animating the composer itself', () => {
    const root = mount(`
      <div data-composer-card>
        <div data-composer-seat data-phase="active"></div>
        <div id="model" role="menu"></div>
        <div id="permission" role="menu"></div>
        <div data-slot="conversation.input.overlay">
          <div id="commands" role="listbox"></div>
        </div>
      </div>
    `)
    expect(classifier.classifySubtree(root).map(item => [item.kind, item.element.id])).toEqual([
      ['menu', 'model'],
      ['menu', 'permission'],
      ['listbox', 'commands'],
    ])
  })

  it('classifies workspace tree disclosure state changes', () => {
    const root = mount(`
      <div data-slot="sidebar.workspaces">
        <div><div id="workspace" role="treeitem" aria-expanded="false"></div></div>
      </div>
    `)
    const workspace = root.querySelector<HTMLElement>('#workspace') as HTMLElement
    workspace.setAttribute('aria-expanded', 'true')
    expect(classifier.classifyAttribute(workspace, 'aria-expanded', 'false')).toMatchObject([
      { kind: 'disclosure', trigger: 'state', state: 'aria-expanded=true' },
    ])
  })

  it('describes finite transient surfaces when their host subtree is removed', () => {
    const menu = mount('<div role="menu"><button role="menuitem">Run</button></div>')
    expect(classifier.classifyRemoval(menu)).toMatchObject([
      { root: menu, surfaces: [{ element: menu, kind: 'menu' }] },
    ])

    const listbox = mount('<div role="listbox"><div role="option">Compact</div></div>')
    expect(classifier.classifyRemoval(listbox)).toMatchObject([
      { root: listbox, surfaces: [{ element: listbox, kind: 'listbox' }] },
    ])

    const overlay = mount(`
      <div role="presentation">
        <div id="mask" aria-hidden="true"></div>
        <section id="dialog" role="dialog" aria-modal="true"></section>
      </div>
    `)
    expect(classifier.classifyRemoval(overlay)).toMatchObject([
      {
        root: overlay,
        surfaces: [
          { element: overlay.querySelector('#dialog'), kind: 'dialog' },
          { element: overlay.querySelector('#mask'), kind: 'mask' },
        ],
      },
    ])
  })

  it('does not animate individual streaming rows', () => {
    const root = mount(`
      <div data-chat-flow>
        <div data-chat-flow-key="turn:1"><div role="menu"></div></div>
      </div>
    `)
    expect(classifier.classifySubtree(root)).toEqual([])
  })

  it('accepts stable dotted slots and rejects outer shell slots', () => {
    const root = mount(`
      <div>
        <div data-slot="settings.plugins.tab"></div>
        <div data-slot="conversation"></div>
        <div data-slot="unstructured"></div>
      </div>
    `)
    expect(classifier.classifySubtree(root).map(item => item.state)).toEqual([
      'data-slot=settings.plugins.tab',
    ])
  })

  it('fails closed for ambiguous markup and explicit opt-out roots', () => {
    const root = mount(`
      <div>
        <div aria-selected="true"></div>
        <section data-dsh-motion="off"><div role="menu"></div></section>
      </div>
    `)
    expect(classifier.classifySubtree(root)).toEqual([])
  })

  it('allows UI under the Angelina body marker but excludes parallax layers', () => {
    document.body.setAttribute('data-dsh-angelina-parallax', '')
    document.body.innerHTML = `
      <div role="menu" id="ui"></div>
      <div data-dsh-angelina-layer="background"><div role="menu" id="layer"></div></div>
    `
    expect(classifier.classifySubtree(document.body).map(item => item.element.id)).toEqual(['ui'])
    document.body.removeAttribute('data-dsh-angelina-parallax')
  })
})
