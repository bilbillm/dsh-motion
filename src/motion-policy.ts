/** Motion categories understood by the classifier and runtime. */
export type MotionKind =
  | 'menu'
  | 'listbox'
  | 'dialog'
  | 'mask'
  | 'tabpanel'
  | 'page'
  | 'slot'
  | 'tab'
  | 'switch'
  | 'disclosure'

/** Resolved policy for one short animation. */
export interface MotionTiming {
  readonly durationMs: number
  readonly easing: string
  readonly distancePx: number
  readonly scaleFrom: number
  readonly opacityFrom: number
}

/** Theme tokens read from the current document. */
export interface MotionTokenSnapshot {
  readonly easing: string
  readonly fastMs: number
  readonly normalMs: number
  readonly slowMs: number
}

export interface MotionPolicyOptions {
  readonly tokenSource?: Element
  readonly mediaQuery?: MediaQueryList
  readonly matchMedia?: (query: string) => MediaQueryList
  readonly computedStyle?: (element: Element) => CSSStyleDeclaration
}

type PolicyListener = (reducedMotion: boolean) => void

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const DEFAULT_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'

const TOKEN_DEFAULTS = Object.freeze({
  fastMs: 140,
  normalMs: 180,
  slowMs: 300,
})

interface DurationRule {
  readonly token: keyof Pick<MotionTokenSnapshot, 'fastMs' | 'normalMs'>
  readonly fallbackMs: number
  readonly minMs: number
  readonly maxMs: number
  readonly distancePx: number
  readonly scaleFrom: number
}

const RULES: Readonly<Record<MotionKind, DurationRule>> = Object.freeze({
  menu: { token: 'fastMs', fallbackMs: 140, minMs: 120, maxMs: 160, distancePx: 4, scaleFrom: 1 },
  listbox: { token: 'fastMs', fallbackMs: 140, minMs: 120, maxMs: 160, distancePx: 4, scaleFrom: 1 },
  dialog: { token: 'normalMs', fallbackMs: 180, minMs: 160, maxMs: 200, distancePx: 0, scaleFrom: 0.985 },
  mask: { token: 'normalMs', fallbackMs: 180, minMs: 160, maxMs: 200, distancePx: 0, scaleFrom: 1 },
  tabpanel: { token: 'fastMs', fallbackMs: 140, minMs: 120, maxMs: 160, distancePx: 3, scaleFrom: 1 },
  page: { token: 'normalMs', fallbackMs: 180, minMs: 160, maxMs: 200, distancePx: 4, scaleFrom: 1 },
  slot: { token: 'fastMs', fallbackMs: 140, minMs: 120, maxMs: 160, distancePx: 3, scaleFrom: 1 },
  tab: { token: 'fastMs', fallbackMs: 120, minMs: 80, maxMs: 140, distancePx: 0, scaleFrom: 1 },
  switch: { token: 'fastMs', fallbackMs: 120, minMs: 80, maxMs: 140, distancePx: 0, scaleFrom: 1 },
  disclosure: { token: 'normalMs', fallbackMs: 180, minMs: 160, maxMs: 220, distancePx: 2, scaleFrom: 1 },
})

/** Parse one CSS time token into milliseconds. */
export function parseCssDuration(value: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s)\s*$/i.exec(value)
  if (match === null) return undefined
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return undefined
  return match[2]?.toLowerCase() === 's' ? amount * 1000 : amount
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function validEasing(value: string): boolean {
  if (value.length === 0 || value.length > 120 || value.includes(';')) return false
  return /^(?:linear|ease|ease-in|ease-out|ease-in-out|cubic-bezier\([^)]*\)|steps\([^)]*\))$/i.test(value)
}

/**
 * Reads host motion tokens and owns the live reduced-motion media query.
 * Surface distances and duration bounds are deliberately internal constants.
 */
export class MotionPolicy {
  private readonly tokenSource: Element | undefined
  private readonly media: MediaQueryList | undefined
  private readonly computedStyle: ((element: Element) => CSSStyleDeclaration) | undefined
  private readonly listeners = new Set<PolicyListener>()
  private reduced = false
  private disposed = false

  private readonly onMediaChange = (event: MediaQueryListEvent): void => {
    this.updateReduced(event.matches)
  }

  constructor(options: MotionPolicyOptions = {}) {
    this.tokenSource = options.tokenSource ?? defaultTokenSource()
    this.computedStyle = options.computedStyle ?? defaultComputedStyle(this.tokenSource)

    const match = options.matchMedia ?? defaultMatchMedia()
    this.media = options.mediaQuery ?? match?.(REDUCED_MOTION_QUERY)
    this.reduced = this.media?.matches === true

    if (this.media !== undefined) {
      if (typeof this.media.addEventListener === 'function') {
        this.media.addEventListener('change', this.onMediaChange)
      } else {
        this.media.addListener(this.onMediaChange)
      }
    }
  }

  /** Whether non-essential motion is currently disabled. */
  get reducedMotion(): boolean {
    return this.reduced
  }

  /** Theme id projected by Harness onto body, when available. */
  get themeId(): string | undefined {
    return this.tokenSource?.ownerDocument?.body?.getAttribute('data-ds-theme') ?? undefined
  }

  /** Read all host duration/easing tokens with validated fallbacks. */
  tokens(): MotionTokenSnapshot {
    const style = this.readStyle()
    const easingValue = style?.getPropertyValue('--ds-ease-in-out').trim() ?? ''
    const easing = validEasing(easingValue) ? easingValue : DEFAULT_EASING
    return {
      easing,
      fastMs: readDuration(style, '--ds-transition-duration-fast', TOKEN_DEFAULTS.fastMs),
      normalMs: readDuration(style, '--ds-transition-duration', TOKEN_DEFAULTS.normalMs),
      slowMs: readDuration(style, '--ds-transition-duration-slow', TOKEN_DEFAULTS.slowMs),
    }
  }

  /** Resolve the bounded timing contract for one semantic surface. */
  timing(kind: MotionKind): MotionTiming {
    const tokens = this.tokens()
    const rule = RULES[kind]
    if (this.reduced) {
      return { durationMs: 0, easing: tokens.easing, distancePx: 0, scaleFrom: 1, opacityFrom: 1 }
    }
    const candidate = Number.isFinite(tokens[rule.token]) ? tokens[rule.token] : rule.fallbackMs
    return {
      durationMs: clamp(candidate, rule.minMs, rule.maxMs),
      easing: tokens.easing,
      distancePx: rule.distancePx,
      scaleFrom: rule.scaleFrom,
      opacityFrom: 0,
    }
  }

  /** Observe live reduced-motion changes. */
  subscribe(listener: PolicyListener): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Release the media-query listener. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.media !== undefined) {
      if (typeof this.media.removeEventListener === 'function') {
        this.media.removeEventListener('change', this.onMediaChange)
      } else {
        this.media.removeListener(this.onMediaChange)
      }
    }
    this.listeners.clear()
  }

  private readStyle(): CSSStyleDeclaration | undefined {
    if (this.tokenSource === undefined || this.computedStyle === undefined) return undefined
    try {
      return this.computedStyle(this.tokenSource)
    } catch {
      return undefined
    }
  }

  private updateReduced(next: boolean): void {
    if (this.reduced === next) return
    this.reduced = next
    for (const listener of this.listeners) listener(next)
  }
}

function readDuration(
  style: CSSStyleDeclaration | undefined,
  property: string,
  fallbackMs: number,
): number {
  if (style === undefined) return fallbackMs
  return parseCssDuration(style.getPropertyValue(property)) ?? fallbackMs
}

function defaultTokenSource(): Element | undefined {
  if (typeof document === 'undefined') return undefined
  return document.documentElement
}

function defaultComputedStyle(
  source: Element | undefined,
): ((element: Element) => CSSStyleDeclaration) | undefined {
  const view = source?.ownerDocument?.defaultView
  if (view === null || view === undefined) return undefined
  return (element: Element) => view.getComputedStyle(element)
}

function defaultMatchMedia(): ((query: string) => MediaQueryList) | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
  return window.matchMedia.bind(window)
}
