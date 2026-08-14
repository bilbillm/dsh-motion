import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const E2E_URL = process.env.DSH_MOTION_E2E_URL
const ARTIFACTS = resolve('work/qa/playwright')

interface CapturedMotion {
  readonly role: string | null
  readonly keyframes: Array<Record<string, unknown>>
  readonly duration: number | null
}

declare global {
  interface Window {
    __DSH_MOTION_CALLS__?: CapturedMotion[]
  }
}

describe.runIf(E2E_URL !== undefined)('dsh-motion browser matrix', () => {
  let browser: Browser
  let page: Page
  const consoleErrors: string[] = []

  beforeAll(async () => {
    await mkdir(ARTIFACTS, { recursive: true })
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', error => { consoleErrors.push(error.message) })

    await page.addInitScript(() => {
      const calls: CapturedMotion[] = []
      window.__DSH_MOTION_CALLS__ = calls
      const animate = Element.prototype.animate
      Element.prototype.animate = function motionProbe(keyframes, options) {
        const frames = Array.isArray(keyframes)
          ? keyframes.map(frame => ({ ...frame }))
          : keyframes === null ? [] : [{ ...keyframes }]
        const duration = typeof options === 'number'
          ? options
          : typeof options?.duration === 'number' ? options.duration : null
        calls.push({ role: this.getAttribute('role'), keyframes: frames, duration })
        return animate.call(this, keyframes, options)
      }
    })

    await page.goto(E2E_URL as string, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-dsh-motion-style]').waitFor({ state: 'attached' })
    await dismissOptionalButton(page, /^(继续|Continue)$/)
    await dismissOptionalButton(page, /^(稍后配置|Configure later|Skip for now)$/)
  })

  afterAll(async () => {
    await browser?.close()
  })

  it('loads the client runtime and emits transform-safe menu motion', async () => {
    await clearCapturedMotion(page)
    const trigger = page.locator('button[aria-haspopup="menu"]').first()
    await trigger.click()
    const menu = page.getByRole('menu').first()
    await menu.waitFor({ state: 'visible' })

    const calls = await capturedMotion(page)
    const menuMotion = calls.find(call => call.role === 'menu')
    expect(menuMotion).toBeDefined()
    expect(menuMotion?.duration).toBeGreaterThanOrEqual(120)
    expect(menuMotion?.duration).toBeLessThanOrEqual(160)
    expect(menuMotion?.keyframes.some(frame => 'translate' in frame)).toBe(true)
    expect(menuMotion?.keyframes.every(frame => !('transform' in frame))).toBe(true)
    await trigger.click()
  })

  it('keeps dialog focus, geometry, and four themes stable at desktop and narrow widths', async () => {
    await page.getByRole('button', { name: /^(设置|Settings)$/ }).click()
    const dialog = page.getByRole('dialog', { name: /^(设置|Settings)$/ })
    await dialog.waitFor({ state: 'visible' })
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)

    for (const viewport of [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'narrow', width: 390, height: 844 },
    ] as const) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      for (const theme of ['light', 'dark', 'angelina-light', 'angelina-dark'] as const) {
        const button = page.locator(
          `button[data-preview="${theme}"], button:has([data-preview="${theme}"])`,
        ).first()
        await button.click()
        await expect.poll(() => page.locator('body').getAttribute('data-ds-theme')).toBe(theme)
        expect(await page.evaluate(() => document.documentElement.scrollWidth
          <= document.documentElement.clientWidth)).toBe(true)
        const box = await dialog.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
        })
        expect(box.left).toBeGreaterThanOrEqual(0)
        expect(box.top).toBeGreaterThanOrEqual(0)
        expect(box.right).toBeLessThanOrEqual(viewport.width)
        expect(box.bottom).toBeLessThanOrEqual(viewport.height)
        await page.screenshot({
          path: resolve(ARTIFACTS, `${theme}-${viewport.name}.png`),
        })
      }
    }
  })

  it('keeps tabs and tabpanels accessible while applying state transitions', async () => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: /^(插件|Plugins)$/ }).first().click()
    const tabs = page.getByRole('tab')
    if (await tabs.count() < 2) return
    const before = await page.getByRole('dialog').boundingBox()
    await tabs.nth(1).click()
    expect(await tabs.nth(1).getAttribute('aria-selected')).toBe('true')
    expect(await page.locator('[role="tabpanel"]:not([hidden])').count()).toBe(1)
    expect(await page.locator('[role="tabpanel"][hidden]').count()).toBeGreaterThanOrEqual(1)
    expect(await tabs.nth(1).getAttribute('data-dsh-motion-state')).toBe('on')
    expect(await page.getByRole('dialog').boundingBox()).toEqual(before)
  })

  it('suppresses transient motion under prefers-reduced-motion', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: /^(关闭|Close)$/ }).click()
    await clearCapturedMotion(page)
    const trigger = page.locator('button[aria-haspopup="menu"]').first()
    await trigger.click()
    await page.getByRole('menu').first().waitFor({ state: 'visible' })
    expect((await capturedMotion(page)).filter(call => call.role === 'menu')).toEqual([])
    expect(await page.getByRole('menu').first().evaluate(element => getComputedStyle(element).transform))
      .toBe('none')
  })

  it('does not emit browser errors', () => {
    expect(consoleErrors).toEqual([])
  })
})

async function dismissOptionalButton(page: Page, label: RegExp): Promise<void> {
  const button = page.getByRole('button', { name: label }).first()
  if (await button.isVisible()) await button.click()
}

async function clearCapturedMotion(page: Page): Promise<void> {
  await page.evaluate(() => { window.__DSH_MOTION_CALLS__ = [] })
}

async function capturedMotion(page: Page): Promise<CapturedMotion[]> {
  return page.evaluate(() => window.__DSH_MOTION_CALLS__ ?? [])
}
