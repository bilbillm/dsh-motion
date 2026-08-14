import type { MotionKind } from './motion-policy.ts'

export type MotionTrigger = 'mount' | 'visibility' | 'state'

/** One finite, semantic request handed from the classifier to the runtime. */
export interface SurfaceIntent {
  readonly element: HTMLElement
  readonly kind: MotionKind
  readonly trigger: MotionTrigger
  readonly state: string
  readonly related?: HTMLElement
}

export const OBSERVED_ATTRIBUTES = Object.freeze([
  'hidden',
  'aria-hidden',
  'aria-selected',
  'aria-checked',
  'open',
  'role',
  'data-phase',
  'data-slot',
])

const OUTER_SLOT_IDS = new Set([
  'root',
  'sidebar',
  'conversation',
  'details',
  'shell.overlay',
  'conversation.session',
  'conversation.composer',
  'conversation.input.overlay',
])

const EARLY_EXCLUSION = [
  '[data-dsh-motion="off"]',
  '[data-chat-flow]',
  '[data-chat-flow-key]',
  '[data-streaming]',
  '[data-composer-seat]',
  '[data-composer-card]',
  '[data-dsh-angelina-layer]',
  '[data-trajectory-scroll]',
  '[data-trajectory-row-key]',
  '[role="tooltip"]',
  '[role="alert"]',
].join(', ')

/** Maps DOM mutations to a small set of stable surface intents. */
export class SurfaceClassifier {
  /** Classify a newly attached subtree without scanning outside that subtree. */
  classifySubtree(root: Node): SurfaceIntent[] {
    const intents: SurfaceIntent[] = []
    const seen = new Set<HTMLElement>()
    const rootElement = asHTMLElement(root)
    if (rootElement !== undefined) this.collectMount(rootElement, intents, seen)

    if (root.nodeType === 1 || root.nodeType === 9 || root.nodeType === 11) {
      const scope = root as ParentNode
      for (const element of scope.querySelectorAll<HTMLElement>('*')) {
        this.collectMount(element, intents, seen)
      }
    }
    return intents
  }

  /** Classify one observer record. */
  classifyMutation(record: MutationRecord): SurfaceIntent[] {
    if (record.type === 'childList') {
      return [...record.addedNodes].flatMap(node => this.classifySubtree(node))
    }
    if (record.type !== 'attributes' || record.attributeName === null) return []
    const element = asHTMLElement(record.target)
    if (element === undefined) return []
    return this.classifyAttribute(element, record.attributeName, record.oldValue)
  }

  /** Classify one relevant attribute transition. */
  classifyAttribute(
    element: HTMLElement,
    attributeName: string,
    oldValue: string | null,
  ): SurfaceIntent[] {
    const current = element.getAttribute(attributeName)
    if (current === oldValue || this.isExcluded(element)) return []

    if (attributeName === 'aria-selected' && element.getAttribute('role') === 'tab') {
      return [intent(element, 'tab', 'state', `aria-selected=${current ?? 'absent'}`)]
    }
    if (attributeName === 'aria-checked' && element.getAttribute('role') === 'switch') {
      return [intent(element, 'switch', 'state', `aria-checked=${current ?? 'absent'}`)]
    }
    if (attributeName === 'data-phase' && this.isConversationPage(element)) {
      return [intent(element, 'page', 'state', `data-phase=${current ?? 'absent'}`)]
    }
    if (attributeName === 'data-slot' && this.isStableSlot(element) && this.isVisibleByAttributes(element)) {
      return [intent(element, 'slot', 'visibility', `data-slot=${current ?? 'absent'}`)]
    }

    if (attributeName === 'hidden' || attributeName === 'aria-hidden'
      || attributeName === 'open' || attributeName === 'role') {
      if (!this.isVisibleByAttributes(element)) return []
      return this.classifyMountElement(element).map(item => ({ ...item, trigger: 'visibility' }))
    }
    return []
  }

  /** Find the direct visual mask paired with a semantic dialog. */
  findDialogMask(dialog: HTMLElement): HTMLElement | undefined {
    const parent = dialog.parentElement
    if (parent === null) return undefined
    for (const sibling of parent.children) {
      if (sibling === dialog) continue
      const candidate = asHTMLElement(sibling)
      if (candidate === undefined || candidate.hidden) continue
      const explicit = candidate.hasAttribute('data-dialog-mask') || candidate.hasAttribute('data-mask')
      const presentationSibling = parent.getAttribute('role') === 'presentation'
        && candidate.getAttribute('aria-hidden') === 'true'
      if (explicit || presentationSibling) {
        return candidate
      }
    }
    return undefined
  }

  /** True for the resident Harness conversation page layer, not nested input phases. */
  isConversationPage(element: HTMLElement): boolean {
    if (!element.hasAttribute('data-phase')) return false
    if (element.closest('[data-chat-flow], [data-composer-seat], [data-streaming]') !== null) return false
    return element.hasAttribute('data-conversation-scroll')
      || element.querySelector('[data-conversation-scroll]') !== null
      || element.closest('[data-ds-conversation-column]') !== null
  }

  /** True for a non-shell slot marker with an addressable dotted key. */
  isStableSlot(element: HTMLElement): boolean {
    const slot = element.getAttribute('data-slot')
    if (slot === null || OUTER_SLOT_IDS.has(slot)) return false
    return /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(slot)
  }

  private collectMount(
    element: HTMLElement,
    output: SurfaceIntent[],
    seen: Set<HTMLElement>,
  ): void {
    for (const item of this.classifyMountElement(element)) {
      if (seen.has(item.element)) continue
      seen.add(item.element)
      output.push(item)
    }
  }

  private classifyMountElement(element: HTMLElement): SurfaceIntent[] {
    if (this.isExcluded(element) || !this.isVisibleByAttributes(element)) return []
    const role = element.getAttribute('role')

    if (role === 'dialog') {
      const mask = this.findDialogMask(element)
      const dialogIntent = mask === undefined
        ? intent(element, 'dialog', 'mount', 'role=dialog')
        : intent(element, 'dialog', 'mount', 'role=dialog', mask)
      if (mask === undefined || this.isExcluded(mask)) return [dialogIntent]
      return [dialogIntent, intent(mask, 'mask', 'mount', 'dialog-mask', element)]
    }
    if (role === 'menu') return [intent(element, 'menu', 'mount', 'role=menu')]
    if (role === 'listbox') return [intent(element, 'listbox', 'mount', 'role=listbox')]
    if (role === 'tabpanel') return [intent(element, 'tabpanel', 'mount', 'role=tabpanel')]
    if (role === 'tab') {
      return [intent(element, 'tab', 'mount', `aria-selected=${element.getAttribute('aria-selected') ?? 'absent'}`)]
    }
    if (role === 'switch') {
      return [intent(element, 'switch', 'mount', `aria-checked=${element.getAttribute('aria-checked') ?? 'absent'}`)]
    }
    if (this.isConversationPage(element)) {
      return [intent(element, 'page', 'mount', `data-phase=${element.getAttribute('data-phase') ?? 'absent'}`)]
    }
    if (this.isStableSlot(element)) {
      return [intent(element, 'slot', 'mount', `data-slot=${element.getAttribute('data-slot') ?? 'absent'}`)]
    }
    return []
  }

  private isVisibleByAttributes(element: HTMLElement): boolean {
    return !element.hidden && element.getAttribute('aria-hidden') !== 'true'
  }

  private isExcluded(element: HTMLElement): boolean {
    return element.closest(EARLY_EXCLUSION) !== null
  }
}

function asHTMLElement(node: Node | Element): HTMLElement | undefined {
  if (node.nodeType !== 1) return undefined
  const element = node as Element
  if (typeof element.matches !== 'function') return undefined
  return element as HTMLElement
}

function intent(
  element: HTMLElement,
  kind: MotionKind,
  trigger: MotionTrigger,
  state: string,
  related?: HTMLElement,
): SurfaceIntent {
  return related === undefined
    ? { element, kind, trigger, state }
    : { element, kind, trigger, state, related }
}
