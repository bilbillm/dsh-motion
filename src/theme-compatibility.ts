import type { MotionKind } from './motion-policy.ts'

export interface ThemeCompatibilityOptions {
  readonly computedStyle?: (element: Element) => CSSStyleDeclaration
}

const ALWAYS_EXCLUDED = [
  '[data-dsh-motion="off"]',
  '[data-chat-flow]',
  '[data-chat-flow-key]',
  '[data-streaming]',
  '[data-composer-seat]',
  '[data-composer-card]',
  '[data-dsh-angelina-layer]',
  '[data-trajectory-scroll]',
  '[data-trajectory-row-key]',
  '[data-summary-scroll-region]',
  '[data-animate-viewport]',
  '[role="tooltip"]',
  '[role="alert"]',
].join(', ')

const SIDEBAR_OR_WORKSPACE = [
  '[data-slot="sidebar"]',
  '[data-slot="sidebar.workspaces"]',
  '[data-slot="sidebar.footer.action"]',
].join(', ')

/** Conservative gate between semantic classification and animation. */
export class ThemeCompatibility {
  private readonly computedStyle: ((element: Element) => CSSStyleDeclaration) | undefined

  constructor(options: ThemeCompatibilityOptions = {}) {
    this.computedStyle = options.computedStyle
  }

  /** Whether a surface can be animated without taking ownership from the host. */
  canAnimate(
    element: HTMLElement,
    kind: MotionKind,
    ownedAnimations: ReadonlySet<unknown> = new Set(),
  ): boolean {
    if (this.isExcluded(element, kind)) return false
    if (!this.isVisible(element, kind)) return false
    if (this.isMeasurementState(element, kind)) return false
    if (this.hasHostAnimation(element, ownedAnimations)) return false
    if ((kind === 'tab' || kind === 'switch') && this.hasHostStateTransition(element)) return false
    return true
  }

  /** Explicit opt-outs and host-owned regions. */
  isExcluded(element: HTMLElement, kind: MotionKind): boolean {
    if (element.closest(ALWAYS_EXCLUDED) !== null) return true
    if (element.matches('[data-ds-app-frame], [data-shell-overlay]')) return true
    if ((kind === 'page' || kind === 'slot')
      && element.closest(SIDEBAR_OR_WORKSPACE) !== null
      && element.closest('[role="dialog"]') === null) return true
    return false
  }

  /** Visibility checks that do not depend on geometry or offsetParent. */
  isVisible(element: HTMLElement, kind: MotionKind): boolean {
    if (element.hidden) return false
    if (kind !== 'mask' && element.getAttribute('aria-hidden') === 'true') return false

    let ancestor = element.parentElement
    while (ancestor !== null) {
      if (ancestor.hidden || ancestor.getAttribute('aria-hidden') === 'true') return false
      ancestor = ancestor.parentElement
    }

    const style = this.styleOf(element)
    if (style === undefined) return true
    if (style.display === 'none') return false
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false
    if (style.getPropertyValue('content-visibility').trim() === 'hidden') return false
    if (kind !== 'mask' && Number(style.opacity) === 0 && style.opacity.trim() !== '') return false
    return true
  }

  /** CSS animations or WAAPI animations already owned by the host/theme. */
  hasHostAnimation(element: HTMLElement, ownedAnimations: ReadonlySet<unknown>): boolean {
    try {
      const animations = typeof element.getAnimations === 'function' ? element.getAnimations() : []
      if (animations.some(animation => !ownedAnimations.has(animation) && animation.playState !== 'finished')) {
        return true
      }
    } catch {
      return true
    }

    const style = this.styleOf(element)
    if (style === undefined) return false
    const names = (style.animationName || style.getPropertyValue('animation-name'))
      .split(',')
      .map(name => name.trim())
      .filter(Boolean)
    return names.some(name => name !== 'none')
  }

  /** Do not replace a host transition already covering the same state colors. */
  hasHostStateTransition(element: HTMLElement): boolean {
    const style = this.styleOf(element)
    if (style === undefined) return false
    const properties = (style.transitionProperty || style.getPropertyValue('transition-property'))
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
    if (properties.length === 0 || properties.every(value => value === 'none')) return false
    const durations = (style.transitionDuration || style.getPropertyValue('transition-duration'))
      .split(',')
      .map(value => value.trim())
    const active = durations.some(value => value !== '' && value !== '0s' && value !== '0ms')
    if (!active) return false
    return properties.some(property => property === 'all'
      || property === 'color'
      || property === 'background'
      || property === 'background-color'
      || property.startsWith('border'))
  }

  private isMeasurementState(element: HTMLElement, kind: MotionKind): boolean {
    if (element.closest('[data-measure], [data-measuring], [data-dsh-measuring]') !== null) return true
    return kind === 'page' && element.getAttribute('data-phase') === 'settling'
  }

  private styleOf(element: Element): CSSStyleDeclaration | undefined {
    try {
      if (this.computedStyle !== undefined) return this.computedStyle(element)
      const view = element.ownerDocument?.defaultView
      return view?.getComputedStyle(element)
    } catch {
      return undefined
    }
  }
}
