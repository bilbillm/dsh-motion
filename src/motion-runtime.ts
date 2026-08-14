import { MotionPolicy } from './motion-policy.ts'
import type { MotionKind, MotionTiming } from './motion-policy.ts'
import { OBSERVED_ATTRIBUTES, SurfaceClassifier } from './surface-classifier.ts'
import type { SurfaceIntent } from './surface-classifier.ts'
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

const STYLE_MARKER = 'data-dsh-motion-style'
const STATE_MARKER = 'data-dsh-motion-state'

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
  private readonly markedStates = new Map<HTMLElement, string | null>()

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

    const target = observationTarget(this.root)
    const MutationObserverImpl = this.document?.defaultView?.MutationObserver
      ?? (typeof MutationObserver === 'undefined' ? undefined : MutationObserver)
    if (target !== undefined && MutationObserverImpl !== undefined) {
      this.observer = new MutationObserverImpl(records => {
        for (const record of records) {
          for (const intent of this.classifier.classifyMutation(record)) this.enqueue(intent)
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
    this.restoreStateMarkers()
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

    if (!this.compatibility.canAnimate(intent.element, intent.kind, this.animations)) return
    if (intent.kind === 'tab' || intent.kind === 'switch') {
      this.markStateTransition(intent.element)
      return
    }

    const timing = this.policy.timing(intent.kind)
    if (timing.durationMs <= 0) return
    this.startAnimation(intent.element, intent.kind, timing)
  }

  private startAnimation(element: HTMLElement, kind: MotionKind, timing: MotionTiming): void {
    this.cancelElementAnimations(element)
    const keyframes = keyframesFor(kind, timing, supportsIndependentTransforms(this.document))
    let animation: MotionAnimation | undefined
    try {
      animation = this.animator(element, keyframes, {
        duration: timing.durationMs,
        easing: timing.easing,
        fill: 'both',
      })
    } catch {
      return
    }
    if (animation === undefined) return

    this.animations.add(animation)
    const elementAnimations = this.animationsByElement.get(element) ?? new Set<MotionAnimation>()
    elementAnimations.add(animation)
    this.animationsByElement.set(element, elementAnimations)

    const settle = (): void => { this.settleAnimation(element, animation as MotionAnimation) }
    if (animation.finished !== undefined && typeof animation.finished.then === 'function') {
      void animation.finished.then(settle, settle)
    } else {
      this.settleTimers.set(animation, setTimeout(settle, timing.durationMs + 34))
    }
  }

  private settleAnimation(element: HTMLElement, animation: MotionAnimation): void {
    const timer = this.settleTimers.get(animation)
    if (timer !== undefined) clearTimeout(timer)
    this.settleTimers.delete(animation)
    if (!this.animations.delete(animation)) return
    const elementAnimations = this.animationsByElement.get(element)
    elementAnimations?.delete(animation)
    if (elementAnimations?.size === 0) this.animationsByElement.delete(element)
    try {
      animation.cancel()
    } catch {
      // A host may already have detached the animated node.
    }
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
    this.animations.clear()
    this.animationsByElement.clear()
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
  if (kind === 'tab' || kind === 'switch') return []
  return independentTransforms
    ? [
        { opacity: timing.opacityFrom, translate: `0 ${String(timing.distancePx)}px` },
        { opacity: 1, translate: '0 0' },
      ]
    : [{ opacity: timing.opacityFrom }, { opacity: 1 }]
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
