import { afterEach, describe, expect, it, vi } from 'vitest'
import { MotionPolicy, parseCssDuration } from '../src/motion-policy.ts'
import { mutableMediaQuery } from './helpers.ts'

afterEach(() => {
  document.documentElement.removeAttribute('style')
  document.body.removeAttribute('data-ds-theme')
})
function installHostTokens(): void {
  const style = document.documentElement.style
  style.setProperty('--ds-ease-in-out', 'cubic-bezier(0.4, 0, 0.2, 1)')
  style.setProperty('--ds-transition-duration-fast', '0.1s')
  style.setProperty('--ds-transition-duration', '0.2s')
  style.setProperty('--ds-transition-duration-slow', '0.3s')
}

describe('parseCssDuration', () => {
  it('accepts seconds and milliseconds and rejects non-time values', () => {
    expect(parseCssDuration('0.2s')).toBe(200)
    expect(parseCssDuration('140ms')).toBe(140)
    expect(parseCssDuration('calc(1s)')).toBeUndefined()
    expect(parseCssDuration('-2ms')).toBeUndefined()
  })
})

describe('MotionPolicy', () => {
  it.each(['light', 'dark', 'angelina-light', 'angelina-dark'])(
    'reads Harness tokens under %s without theme-specific values',
    (theme) => {
      installHostTokens()
      document.body.setAttribute('data-ds-theme', theme)
      const media = mutableMediaQuery(false)
      const policy = new MotionPolicy({ tokenSource: document.documentElement, mediaQuery: media.query })

      expect(policy.themeId).toBe(theme)
      expect(policy.tokens()).toEqual({
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fastMs: 100,
        normalMs: 200,
        slowMs: 300,
      })
      expect(policy.timing('menu').durationMs).toBe(120)
      expect(policy.timing('dialog').durationMs).toBe(200)
      expect(policy.timing('page').distancePx).toBe(4)
      policy.dispose()
    },
  )

  it('uses conservative fallbacks for missing or unsafe tokens', () => {
    document.documentElement.style.setProperty('--ds-ease-in-out', 'linear; opacity: 0')
    const policy = new MotionPolicy({ tokenSource: document.documentElement })
    expect(policy.tokens()).toEqual({
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      fastMs: 140,
      normalMs: 180,
      slowMs: 300,
    })
    expect(policy.timing('menu').durationMs).toBe(140)
    expect(policy.timing('dialog').durationMs).toBe(180)
    policy.dispose()
  })

  it('removes movement, scaling, and fades when reduced motion starts enabled', () => {
    const media = mutableMediaQuery(true)
    const policy = new MotionPolicy({ tokenSource: document.documentElement, mediaQuery: media.query })
    expect(policy.reducedMotion).toBe(true)
    expect(policy.timing('dialog')).toMatchObject({
      durationMs: 0,
      distancePx: 0,
      scaleFrom: 1,
      opacityFrom: 1,
    })
    policy.dispose()
  })

  it('publishes live preference changes and detaches its listener', () => {
    const media = mutableMediaQuery(false)
    const policy = new MotionPolicy({ tokenSource: document.documentElement, mediaQuery: media.query })
    const listener = vi.fn()
    policy.subscribe(listener)

    media.setMatches(true)
    media.setMatches(true)
    media.setMatches(false)
    expect(listener.mock.calls).toEqual([[true], [false]])
    expect(policy.timing('page').durationMs).toBeGreaterThan(0)

    policy.dispose()
    expect(media.remove).toHaveBeenCalledOnce()
    media.setMatches(true)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
