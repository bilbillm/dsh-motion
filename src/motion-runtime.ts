import { MotionPolicy } from './motion-policy.ts'
import type { MotionKind, MotionTiming } from './motion-policy.ts'
import { OBSERVED_ATTRIBUTES, SurfaceClassifier } from './surface-classifier.ts'
import type { RemovalSurface, SurfaceIntent } from './surface-classifier.ts'
import { ThemeCompatibility } from './theme-compatibility.ts'

export interface MotionAnimation {
  readonly playState?: string
  readonly finished?: Promise<unknown>
  cancel(): void
}

export type MotionAnimator = (
  element: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) => MotionAnimation | undefined

export interface MotionRuntimeOptions {
  readonly root?: Document | HTMLElement
  readonly policy?: MotionPolicy
  readonly classifier?: SurfaceClassifier
  readonly compatibility?: ThemeCompatibility
  readonly animator?: MotionAnimator
  readonly requestFrame?: (callback: () => void) => number
  readonly cancelFrame?: (handle: number) => void
  readonly onIntent?: (intent: SurfaceIntent) => void
}

interface AnimationSpec {
  readonly element: HTMLElement
  readonly keyframes: Keyframe[]
  readonly timing: MotionTiming
}

interface DisclosureChildSnapshot {
  readonly clone: HTMLElement
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

interface DisclosureSnapshot {
  readonly expanded: boolean
  readonly height: number
  readonly children: readonly DisclosureChildSnapshot[]
}

interface MenuReplacementBatch {
  readonly removedNodes: Node[]
  hasAddedNodes: boolean
}

const STYLE_MARKER = 'data-dsh-motion-style'
const STATE_MARKER = 'data-dsh-motion-state'
const GHOST_MARKER = 'data-dsh-motion-ghost'
const DISCLOSURE_GHOST_MARKER = 'data-dsh-motion-disclosure-ghost'
const MENU_PAGE_GHOST_MARKER = 'data-dsh-motion-menu-page-ghost'

const STATE_STYLES = `
:where([${STATE_MARKER}="on"]) {
  transition-property: color, background-color, border-color;
  transition-duration: var(--ds-transition-duration-fast, 120ms);
  transition-timing-function: var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1));
}
@media (prefers-reduced-motion: reduce) {
  :where([${STATE_MARKER}="on"]) {
    transition-duration: 0ms;
  }
}
`

/** One observer, one per-frame batch, and no idle work. */
export class MotionRuntime {
  private readonly root: Document | HTMLElement | undefined
  private readonly document: Document | undefined
  private readonly policy: MotionPolicy
  private readonly ownsPolicy: boolean
  private readonly classifier: SurfaceClassifier
  private readonly compatibility: ThemeCompatibility
  private readonly animator: MotionAnimator
  private readonly requestFrame: ((callback: () => void) => number) | undefined
  private readonly cancelFrame: ((handle: number) => void) | undefined
  private readonly onIntent: ((intent: SurfaceIntent) => void) | undefined

  private observer: MutationObserver | undefined
  private frameHandle: number | undefined
  private styleElement: HTMLStyleElement | undefined
  private policyDispose: (() => void) | undefined
  private started = false
  private disposed = false

  private readonly pending = new Map<HTMLElement, Map<MotionKind, SurfaceIntent>>()
  private readonly lastApplied = new WeakMap<HTMLElement, Map<MotionKind, string>>()
  private readonly animations = new Set<MotionAnimation>()
  private readonly animationsByElement = new Map<HTMLElement, Set<MotionAnimation>>()
  private readonly settleTimers = new Map<MotionAnimation, ReturnType<typeof setTimeout>>()
  private readonly settleCallbacks = new Map<MotionAnimation, () => void>()
  private readonly markedStates = new Map<HTMLElement, string | null>()
  private readonly exitGhosts = new Set<HTMLElement>()
  private readonly disclosureSnapshots = new Map<HTMLElement, DisclosureSnapshot>()
  private readonly disclosureCancels = new Map<HTMLElement, () => void>()

  constructor(options: MotionRuntimeOptions = {}) {
    this.root = options.root ?? defaultRoot()
    this.document = documentFor(this.root)
    this.ownsPolicy = options.policy === undefined
    this.policy = options.policy ?? new MotionPolicy({
      ...(this.document?.documentElement === undefined
        ? {}
        : { tokenSource: this.document.documentElement }),
    })
    this.classifier = options.classifier ?? new SurfaceClassifier()
    this.compatibility = options.compatibility ?? new ThemeCompatibility()
    this.animator = options.animator ?? defaultAnimator
    this.requestFrame = options.requestFrame ?? defaultRequestFrame(this.document)
    this.cancelFrame = options.cancelFrame ?? defaultCancelFrame(this.document)
    this.onIntent = options.onIntent
  }

  /** Begin observing future mutations. Existing UI is not replay-animated. */
  start(): () => void {
    if (this.started || this.disposed) return () => { this.dispose() }
    this.started = true
    this.installStyle()
    this.seedExistingStateControls()
    this.seedExistingDisclosures()

    const target = observationTarget(this.root)
    const MutationObserverImpl = this.document?.defaultView?.MutationObserver
      ?? (typeof MutationObserver === 'undefined' ? undefined : MutationObserver)
    if (target !== undefined && MutationObserverImpl !== undefined) {
      this.observer = new MutationObserverImpl(records => {
        const changedDisclosures = new Set<HTMLElement>()
        const menuReplacements = this.collectMenuReplacements(records)
        for (const record of records) {
          if (record.type === 'childList') {
            const replacingMenu = record.target.nodeType === 1
              && menuReplacements.get(record.target as HTMLElement)?.hasAddedNodes === true
            if (!replacingMenu) {
              for (const removed of record.removedNodes) this.animateRemoval(record, removed)
            }
          }
          for (const intent of this.classifier.classifyMutation(record)) {
            if (intent.kind === 'disclosure') changedDisclosures.add(intent.element)
            this.enqueue(intent)
          }
        }
        for (const record of records) {
          if (record.type !== 'childList') continue
          this.refreshDisclosureSnapshotFor(record.target, changedDisclosures)
          for (const added of record.addedNodes) this.seedDisclosureSubtree(added, changedDisclosures)
        }
        for (const [menu, replacement] of menuReplacements) {
          if (replacement.hasAddedNodes && replacement.removedNodes.length > 0) {
            this.animateMenuReplacement(menu, replacement.removedNodes)
          }
        }
        this.pruneDisconnectedStateMarkers()
      })
      this.observer.observe(target, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: [...OBSERVED_ATTRIBUTES],
      })
    }

    this.policyDispose = this.policy.subscribe((reduced) => {
      if (reduced) this.cancelAllAnimations()
    })
    return () => { this.dispose() }
  }

  /** Queue an intent and coalesce repeated changes to the same surface/kind. */
  enqueue(intent: SurfaceIntent): void {
    if (this.disposed) return
    const byKind = this.pending.get(intent.element) ?? new Map<MotionKind, SurfaceIntent>()
    byKind.set(intent.kind, intent)
    this.pending.set(intent.element, byKind)
    this.onIntent?.(intent)
    this.scheduleFlush()
  }

  /** Flush the current batch synchronously (primarily useful for tests). */
  flushNow(): void {
    if (this.frameHandle !== undefined && this.cancelFrame !== undefined) {
      this.cancelFrame(this.frameHandle)
    }
    this.frameHandle = undefined
    this.flush()
  }

  /** Current active WAAPI animation count. */
  activeAnimationCount(): number {
    return this.animations.size
  }

  /** Complete lifecycle teardown. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.observer?.disconnect()
    this.observer = undefined
    if (this.frameHandle !== undefined && this.cancelFrame !== undefined) {
      this.cancelFrame(this.frameHandle)
    }
    this.frameHandle = undefined
    this.pending.clear()
    this.policyDispose?.()
    this.policyDispose = undefined
    this.cancelAllAnimations()
    this.removeAllGhosts()
    this.restoreStateMarkers()
    this.disclosureSnapshots.clear()
    this.disclosureCancels.clear()
    this.styleElement?.remove()
    this.styleElement = undefined
    if (this.ownsPolicy) this.policy.dispose()
  }

  private scheduleFlush(): void {
    if (this.frameHandle !== undefined) return
    if (this.requestFrame !== undefined) {
      this.frameHandle = this.requestFrame(() => {
        this.frameHandle = undefined
        this.flush()
      })
      return
    }
    const timer = setTimeout(() => {
      this.frameHandle = undefined
      this.flush()
    }, 0)
    this.frameHandle = Number(timer)
  }

  private flush(): void {
    if (this.disposed || this.pending.size === 0) return
    const batch = [...this.pending.entries()]
    this.pending.clear()

    for (const [element, byKind] of batch) {
      if (!element.isConnected) continue
      for (const intent of byKind.values()) this.applyIntent(intent)
    }
  }

  private applyIntent(intent: SurfaceIntent): void {
    const signature = `${intent.trigger}:${intent.state}`
    const applied = this.lastApplied.get(intent.element) ?? new Map<MotionKind, string>()
    if (applied.get(intent.kind) === signature) return
    applied.set(intent.kind, signature)
    this.lastApplied.set(intent.element, applied)

    const compatibilityElement = intent.kind === 'disclosure'
      ? this.workspaceSectionFor(intent.element) ?? intent.element
      : intent.element
    if (!this.compatibility.canAnimate(compatibilityElement, intent.kind, this.animations)) return
    if (intent.kind === 'tab' || intent.kind === 'switch') {
      this.markStateTransition(intent.element)
      return
    }

    const timing = this.policy.timing(intent.kind)
    if (intent.kind === 'disclosure') {
      this.animateDisclosure(intent.element, timing)
      return
    }
    if (timing.durationMs <= 0) return
    this.startAnimation(intent.element, intent.kind, timing)
  }

  private startAnimation(element: HTMLElement, kind: MotionKind, timing: MotionTiming): MotionAnimation | undefined {
    return this.startKeyframeAnimation(
      element,
      keyframesFor(kind, timing, supportsIndependentTransforms(this.document)),
      timing,
    )
  }

  private startKeyframeAnimation(
    element: HTMLElement,
    keyframes: Keyframe[],
    timing: MotionTiming,
    onSettled?: () => void,
  ): MotionAnimation | undefined {
    this.cancelElementAnimations(element)
    let animation: MotionAnimation | undefined
    try {
      animation = this.animator(element, keyframes, {
        duration: timing.durationMs,
        easing: timing.easing,
        fill: 'both',
      })
    } catch {
      return undefined
    }
    if (animation === undefined) return undefined

    this.animations.add(animation)
    if (onSettled !== undefined) this.settleCallbacks.set(animation, onSettled)
    const elementAnimations = this.animationsByElement.get(element) ?? new Set<MotionAnimation>()
    elementAnimations.add(animation)
    this.animationsByElement.set(element, elementAnimations)

    const settle = (): void => { this.settleAnimation(element, animation as MotionAnimation) }
    if (animation.finished !== undefined && typeof animation.finished.then === 'function') {
      void animation.finished.then(settle, settle)
    } else {
      this.settleTimers.set(animation, setTimeout(settle, timing.durationMs + 34))
    }
    return animation
  }

  private settleAnimation(element: HTMLElement, animation: MotionAnimation): void {
    const timer = this.settleTimers.get(animation)
    if (timer !== undefined) clearTimeout(timer)
    this.settleTimers.delete(animation)
    if (!this.animations.delete(animation)) return
    const onSettled = this.settleCallbacks.get(animation)
    this.settleCallbacks.delete(animation)
    const elementAnimations = this.animationsByElement.get(element)
    elementAnimations?.delete(animation)
    if (elementAnimations?.size === 0) this.animationsByElement.delete(element)
    try {
      animation.cancel()
    } catch {
      // A host may already have detached the animated node.
    }
    onSettled?.()
  }

  private cancelElementAnimations(element: HTMLElement): void {
    const active = this.animationsByElement.get(element)
    if (active === undefined) return
    for (const animation of [...active]) this.settleAnimation(element, animation)
  }

  private cancelAllAnimations(): void {
    for (const [element, active] of [...this.animationsByElement.entries()]) {
      for (const animation of [...active]) this.settleAnimation(element, animation)
    }
    for (const timer of this.settleTimers.values()) clearTimeout(timer)
    this.settleTimers.clear()
    this.settleCallbacks.clear()
    this.animations.clear()
    this.animationsByElement.clear()
    this.disclosureCancels.clear()
  }

  private startAnimationGroup(specs: readonly AnimationSpec[], cleanup: () => void): () => void {
    let remaining = 0
    let armed = false
    let cleaned = false
    const activeElements: HTMLElement[] = []
    const settle = (): void => {
      remaining -= 1
      if (armed && remaining === 0 && !cleaned) {
        cleaned = true
        cleanup()
      }
    }
    for (const spec of specs) {
      remaining += 1
      if (this.startKeyframeAnimation(spec.element, spec.keyframes, spec.timing, settle) === undefined) {
        remaining -= 1
      } else {
        activeElements.push(spec.element)
      }
    }
    armed = true
    if (remaining === 0 && !cleaned) {
      cleaned = true
      cleanup()
    }
    return () => {
      for (const element of activeElements) this.cancelElementAnimations(element)
    }
  }

  private animateRemoval(record: MutationRecord, removed: Node): void {
    if (this.policy.reducedMotion || removed.isConnected) return
    const parent = record.target.nodeType === 1
      ? record.target as HTMLElement
      : this.document?.body
    if (parent === undefined || !parent.isConnected) return
    for (const removal of this.classifier.classifyRemoval(removed)) {
      this.createExitGhost(parent, record.nextSibling, removal)
    }
  }

  private collectMenuReplacements(records: readonly MutationRecord[]): Map<HTMLElement, MenuReplacementBatch> {
    const replacements = new Map<HTMLElement, MenuReplacementBatch>()
    for (const record of records) {
      if (record.type !== 'childList' || record.target.nodeType !== 1) continue
      const menu = record.target as HTMLElement
      if (!menu.isConnected || !this.classifier.isMenuContentSurface(menu)) continue
      const batch = replacements.get(menu) ?? { removedNodes: [], hasAddedNodes: false }
      for (const removed of record.removedNodes) {
        if (removed.nodeType === 1 || removed.nodeType === 3) batch.removedNodes.push(removed)
      }
      if (record.addedNodes.length > 0) batch.hasAddedNodes = true
      replacements.set(menu, batch)
    }
    return replacements
  }

  private animateMenuReplacement(menu: HTMLElement, removedNodes: readonly Node[]): void {
    if (this.policy.reducedMotion || !menu.isConnected
      || !this.compatibility.canAnimate(menu, 'menu', this.animations)) return
    const timing = this.policy.timing('menu')
    if (timing.durationMs <= 0) return
    const parent = menu.parentElement
    if (parent === null) return

    const ghost = menu.cloneNode(false) as HTMLElement
    for (const removed of removedNodes) ghost.appendChild(removed.cloneNode(true))
    if (ghost.childNodes.length === 0) return
    const oldHasChoices = ghost.querySelector('[role="menuitemradio"]') !== null
    const newHasChoices = menu.querySelector('[role="menuitemradio"]') !== null
    const direction: -1 | 1 = oldHasChoices && !newHasChoices ? -1 : 1
    prepareGhost(ghost, MENU_PAGE_GHOST_MARKER)
    parent.insertBefore(ghost, menu.nextSibling)
    this.exitGhosts.add(ghost)

    const independent = supportsIndependentTransforms(this.document)
    this.startAnimationGroup([
      {
        element: ghost,
        keyframes: menuPageKeyframes(timing, independent, direction, true),
        timing,
      },
      {
        element: menu,
        keyframes: menuPageKeyframes(timing, independent, direction, false),
        timing,
      },
    ], () => { this.removeGhost(ghost) })
  }

  private createExitGhost(parent: HTMLElement, nextSibling: Node | null, removal: RemovalSurface): void {
    const paths = removal.surfaces.map(surface => ({
      kind: surface.kind,
      path: elementPath(removal.root, surface.element),
    }))
    if (paths.some(item => item.path === undefined)) return
    const ghost = removal.root.cloneNode(true) as HTMLElement
    prepareGhost(ghost, GHOST_MARKER)
    const anchor = nextSibling?.parentNode === parent ? nextSibling : null
    parent.insertBefore(ghost, anchor)
    this.exitGhosts.add(ghost)

    const independent = supportsIndependentTransforms(this.document)
    const specs: AnimationSpec[] = []
    for (const item of paths) {
      const element = elementAtPath(ghost, item.path as readonly number[])
      if (element === undefined) continue
      const timing = this.policy.timing(item.kind)
      if (timing.durationMs <= 0) continue
      specs.push({
        element,
        keyframes: exitKeyframesFor(item.kind, timing, independent),
        timing,
      })
    }
    this.startAnimationGroup(specs, () => { this.removeGhost(ghost) })
  }

  private animateDisclosure(element: HTMLElement, timing: MotionTiming): void {
    this.disclosureCancels.get(element)?.()
    this.disclosureCancels.delete(element)
    const previous = this.disclosureSnapshots.get(element)
    const current = this.captureDisclosureSnapshot(element)
    if (current === undefined) return
    this.disclosureSnapshots.set(element, current)
    if (timing.durationMs <= 0) return
    if (previous === undefined || previous.height <= 0 || current.height <= 0
      || previous.height === current.height) return

    const section = this.workspaceSectionFor(element)
    if (section === undefined) return
    this.cancelElementAnimations(section)
    const previousOverflow = section.style.overflow
    const previousPosition = section.style.position
    const computedPosition = this.computedPosition(section)
    section.style.overflow = 'hidden'
    if (computedPosition === 'static' || computedPosition === '') section.style.position = 'relative'
    const ghosts: HTMLElement[] = []
    const independent = supportsIndependentTransforms(this.document)
    const specs: AnimationSpec[] = [{
      element: section,
      keyframes: [{ height: `${String(previous.height)}px` }, { height: `${String(current.height)}px` }],
      timing,
    }]

    if (previous.expanded && !current.expanded) {
      for (const child of previous.children) {
        const ghost = child.clone.cloneNode(true) as HTMLElement
        prepareGhost(ghost, DISCLOSURE_GHOST_MARKER)
        Object.assign(ghost.style, {
          position: 'absolute',
          left: `${String(child.left)}px`,
          top: `${String(child.top)}px`,
          width: `${String(child.width)}px`,
          height: `${String(child.height)}px`,
          margin: '0',
        })
        section.appendChild(ghost)
        ghosts.push(ghost)
        this.exitGhosts.add(ghost)
        specs.push({
          element: ghost,
          keyframes: independent
            ? [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: `0 -${String(timing.distancePx)}px` }]
            : [{ opacity: 1 }, { opacity: 0 }],
          timing,
        })
      }
    }

    let settledSynchronously = false
    let cancelGroup = (): void => {}
    cancelGroup = this.startAnimationGroup(specs, () => {
      settledSynchronously = true
      section.style.overflow = previousOverflow
      section.style.position = previousPosition
      for (const ghost of ghosts) this.removeGhost(ghost)
      if (this.disclosureCancels.get(element) === cancelGroup) this.disclosureCancels.delete(element)
    })
    if (!settledSynchronously) this.disclosureCancels.set(element, cancelGroup)
  }

  private markStateTransition(element: HTMLElement): void {
    if (!this.markedStates.has(element)) {
      this.markedStates.set(element, element.getAttribute(STATE_MARKER))
    }
    element.setAttribute(STATE_MARKER, 'on')
  }

  private restoreStateMarkers(): void {
    for (const [element, previous] of this.markedStates) {
      if (previous === null) element.removeAttribute(STATE_MARKER)
      else element.setAttribute(STATE_MARKER, previous)
    }
    this.markedStates.clear()
  }

  private pruneDisconnectedStateMarkers(): void {
    for (const element of this.markedStates.keys()) {
      if (!element.isConnected) this.markedStates.delete(element)
    }
    for (const element of this.disclosureSnapshots.keys()) {
      if (!element.isConnected) {
        this.disclosureCancels.get(element)?.()
        this.disclosureCancels.delete(element)
        this.disclosureSnapshots.delete(element)
      }
    }
  }

  private installStyle(): void {
    if (this.document === undefined || this.styleElement !== undefined) return
    const style = this.document.createElement('style')
    style.setAttribute(STYLE_MARKER, '')
    style.textContent = STATE_STYLES
    const parent = this.document.head ?? this.document.documentElement
    parent?.appendChild(style)
    this.styleElement = style
  }

  private seedExistingStateControls(): void {
    if (this.root === undefined) return
    const scope = this.root as ParentNode
    for (const element of scope.querySelectorAll<HTMLElement>('[role="tab"], [role="switch"]')) {
      for (const intent of this.classifier.classifySubtree(element)) {
        if (intent.kind === 'tab' || intent.kind === 'switch') this.enqueue(intent)
      }
    }
  }

  private seedExistingDisclosures(): void {
    if (this.root === undefined) return
    const scope = this.root as ParentNode
    for (const element of scope.querySelectorAll<HTMLElement>(
      '[data-slot="sidebar.workspaces"] [role="treeitem"][aria-expanded]',
    )) {
      const snapshot = this.captureDisclosureSnapshot(element)
      if (snapshot !== undefined) this.disclosureSnapshots.set(element, snapshot)
    }
  }

  private seedDisclosureSubtree(root: Node, skip: ReadonlySet<HTMLElement>): void {
    if (root.nodeType !== 1) return
    const element = root as HTMLElement
    const candidates = element.matches('[role="treeitem"][aria-expanded]')
      ? [element, ...element.querySelectorAll<HTMLElement>('[role="treeitem"][aria-expanded]')]
      : [...element.querySelectorAll<HTMLElement>('[role="treeitem"][aria-expanded]')]
    for (const candidate of candidates) {
      if (skip.has(candidate) || candidate.closest('[data-slot="sidebar.workspaces"]') === null) continue
      const snapshot = this.captureDisclosureSnapshot(candidate)
      if (snapshot !== undefined) this.disclosureSnapshots.set(candidate, snapshot)
    }
  }

  private refreshDisclosureSnapshotFor(target: Node, skip: ReadonlySet<HTMLElement>): void {
    if (target.nodeType !== 1) return
    const element = target as HTMLElement
    const disclosure = element.matches('[role="treeitem"][aria-expanded]')
      ? element
      : element.querySelector<HTMLElement>('[role="treeitem"][aria-expanded]')
    if (disclosure === null || skip.has(disclosure)
      || disclosure.closest('[data-slot="sidebar.workspaces"]') === null) return
    const snapshot = this.captureDisclosureSnapshot(disclosure)
    if (snapshot !== undefined) this.disclosureSnapshots.set(disclosure, snapshot)
  }

  private captureDisclosureSnapshot(element: HTMLElement): DisclosureSnapshot | undefined {
    const section = this.workspaceSectionFor(element)
    if (section === undefined) return undefined
    const sectionRect = section.getBoundingClientRect()
    const expanded = element.getAttribute('aria-expanded') === 'true'
    const children = expanded
      ? [...section.children]
          .filter((child): child is HTMLElement => child instanceof HTMLElement
            && !child.contains(element) && !child.hasAttribute(GHOST_MARKER))
          .map((child) => {
            const rect = child.getBoundingClientRect()
            return {
              clone: child.cloneNode(true) as HTMLElement,
              left: rect.left - sectionRect.left,
              top: rect.top - sectionRect.top,
              width: rect.width,
              height: rect.height,
            }
          })
      : []
    return { expanded, height: sectionRect.height, children }
  }

  private workspaceSectionFor(element: HTMLElement): HTMLElement | undefined {
    if (element.closest('[data-slot="sidebar.workspaces"]') === null) return undefined
    const tree = element.closest<HTMLElement>('[role="tree"]')
    if (tree === null) return undefined
    let section = element.parentElement
    while (section !== null && section.parentElement !== tree) section = section.parentElement
    return section?.parentElement === tree ? section : undefined
  }

  private computedPosition(element: HTMLElement): string {
    try {
      return this.document?.defaultView?.getComputedStyle(element).position ?? ''
    } catch {
      return ''
    }
  }

  private removeGhost(ghost: HTMLElement): void {
    this.exitGhosts.delete(ghost)
    ghost.remove()
  }

  private removeAllGhosts(): void {
    for (const ghost of this.exitGhosts) ghost.remove()
    this.exitGhosts.clear()
  }
}

/** Keyframes intentionally never write the positioning transform property. */
export function keyframesFor(
  kind: MotionKind,
  timing: MotionTiming,
  independentTransforms: boolean,
): Keyframe[] {
  if (kind === 'mask') return [{ opacity: timing.opacityFrom }, { opacity: 1 }]
  if (kind === 'dialog') {
    return independentTransforms
      ? [
          { opacity: timing.opacityFrom, scale: String(timing.scaleFrom) },
          { opacity: 1, scale: '1' },
        ]
      : [{ opacity: timing.opacityFrom }, { opacity: 1 }]
  }
  if (kind === 'tab' || kind === 'switch' || kind === 'disclosure') return []
  return independentTransforms
    ? [
        { opacity: timing.opacityFrom, translate: `0 ${String(timing.distancePx)}px` },
        { opacity: 1, translate: '0 0' },
      ]
    : [{ opacity: timing.opacityFrom }, { opacity: 1 }]
}

/** Exit frames mirror entry motion without touching the positioning transform. */
export function exitKeyframesFor(
  kind: MotionKind,
  timing: MotionTiming,
  independentTransforms: boolean,
): Keyframe[] {
  if (kind === 'mask') return [{ opacity: 1 }, { opacity: 0 }]
  if (kind === 'dialog') {
    return independentTransforms
      ? [{ opacity: 1, scale: '1' }, { opacity: 0, scale: String(timing.scaleFrom) }]
      : [{ opacity: 1 }, { opacity: 0 }]
  }
  if (kind === 'tab' || kind === 'switch' || kind === 'disclosure') return []
  return independentTransforms
    ? [
        { opacity: 1, translate: '0 0' },
        { opacity: 0, translate: `0 ${String(timing.distancePx)}px` },
      ]
      : [{ opacity: 1 }, { opacity: 0 }]
}

function menuPageKeyframes(
  timing: MotionTiming,
  independentTransforms: boolean,
  direction: -1 | 1,
  exiting: boolean,
): Keyframe[] {
  if (!independentTransforms) {
    return exiting
      ? [
          { opacity: 1, offset: 0 },
          { opacity: 0, offset: 0.45 },
          { opacity: 0, offset: 1 },
        ]
      : [
          { opacity: timing.opacityFrom, offset: 0 },
          { opacity: timing.opacityFrom, offset: 0.25 },
          { opacity: 1, offset: 1 },
        ]
  }
  const distance = timing.distancePx * direction
  return exiting
    ? [
        { opacity: 1, translate: '0 0', offset: 0 },
        { opacity: 0, translate: `${String(-distance)}px 0`, offset: 0.45 },
        { opacity: 0, translate: `${String(-distance)}px 0`, offset: 1 },
      ]
    : [
        { opacity: timing.opacityFrom, translate: `${String(distance)}px 0`, offset: 0 },
        { opacity: timing.opacityFrom, translate: `${String(distance)}px 0`, offset: 0.25 },
        { opacity: 1, translate: '0 0', offset: 1 },
      ]
}

function elementPath(root: HTMLElement, element: HTMLElement): readonly number[] | undefined {
  if (root === element) return []
  const path: number[] = []
  let current: HTMLElement | null = element
  while (current !== null && current !== root) {
    const parent: HTMLElement | null = current.parentElement
    if (parent === null) return undefined
    const index = [...parent.children].indexOf(current)
    if (index < 0) return undefined
    path.unshift(index)
    current = parent
  }
  return current === root ? path : undefined
}

function elementAtPath(root: HTMLElement, path: readonly number[]): HTMLElement | undefined {
  let current = root
  for (const index of path) {
    const child = current.children.item(index)
    if (!(child instanceof HTMLElement)) return undefined
    current = child
  }
  return current
}

function prepareGhost(root: HTMLElement, detailMarker: string): void {
  root.setAttribute(GHOST_MARKER, '')
  root.setAttribute(detailMarker, '')
  root.setAttribute('aria-hidden', 'true')
  root.setAttribute('inert', '')
  root.style.pointerEvents = 'none'
  for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    element.removeAttribute('id')
    element.removeAttribute('aria-controls')
    element.removeAttribute('aria-labelledby')
    element.removeAttribute('aria-describedby')
    element.setAttribute('tabindex', '-1')
    element.style.animation = 'none'
    element.style.transition = 'none'
  }
}

function defaultRoot(): Document | undefined {
  return typeof document === 'undefined' ? undefined : document
}

function documentFor(root: Document | HTMLElement | undefined): Document | undefined {
  if (root === undefined) return undefined
  return root.nodeType === 9 ? root as Document : root.ownerDocument ?? undefined
}

function observationTarget(root: Document | HTMLElement | undefined): Node | undefined {
  if (root === undefined) return undefined
  if (root.nodeType !== 9) return root
  const doc = root as Document
  return doc.body ?? doc.documentElement ?? undefined
}

function defaultRequestFrame(documentValue: Document | undefined): ((callback: () => void) => number) | undefined {
  const view = documentValue?.defaultView
  return typeof view?.requestAnimationFrame === 'function'
    ? callback => view.requestAnimationFrame(() => { callback() })
    : undefined
}

function defaultCancelFrame(documentValue: Document | undefined): ((handle: number) => void) | undefined {
  const view = documentValue?.defaultView
  return typeof view?.cancelAnimationFrame === 'function'
    ? handle => { view.cancelAnimationFrame(handle) }
    : handle => { clearTimeout(handle) }
}

function defaultAnimator(
  element: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): MotionAnimation | undefined {
  if (typeof element.animate !== 'function') return undefined
  return element.animate(keyframes, options)
}

function supportsIndependentTransforms(documentValue: Document | undefined): boolean {
  const css = documentValue?.defaultView?.CSS
  if (css === undefined || typeof css.supports !== 'function') return true
  return css.supports('translate', '0 1px') && css.supports('scale', '0.985')
}
