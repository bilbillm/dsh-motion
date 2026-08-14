import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const E2E_URL = process.env.DSH_MOTION_E2E_URL
const ARTIFACTS = resolve('work/qa/playwright')

interface CapturedMotion {
  readonly role: string | null
  readonly ghost: boolean
  readonly menuPageGhost: boolean
  readonly nestedInDialog: boolean
  readonly backdropFilter: string
  readonly pointerEvents: string
  readonly ghostPointerSafe: boolean
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
      window.__DSH_MOTION_CALLS__ = []
      const animate = Element.prototype.animate
      Element.prototype.animate = function motionProbe(keyframes, options) {
        const ghostRoot = this.closest('[data-dsh-motion-ghost]')
        const owningDialog = this.closest('[role="dialog"]')
        const frames = Array.isArray(keyframes)
          ? keyframes.map(frame => ({ ...frame }))
          : keyframes === null ? [] : [{ ...keyframes }]
        const duration = typeof options === 'number'
          ? options
          : typeof options?.duration === 'number' ? options.duration : null
        window.__DSH_MOTION_CALLS__?.push({
          role: this.getAttribute('role'),
          ghost: ghostRoot !== null,
          menuPageGhost: this.hasAttribute('data-dsh-motion-menu-page-ghost'),
          nestedInDialog: owningDialog !== null && owningDialog !== this,
          backdropFilter: (this as HTMLElement).style.getPropertyValue('backdrop-filter'),
          pointerEvents: (this as HTMLElement).style.pointerEvents,
          ghostPointerSafe: ghostRoot === null
            || [ghostRoot, ...ghostRoot.querySelectorAll('*')]
              .every(element => (element as HTMLElement).style.pointerEvents === 'none'),
          keyframes: frames,
          duration,
        })
        return animate.call(this, keyframes, options)
      }
    })

    await page.goto(E2E_URL as string, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-dsh-motion-style]').waitFor({ state: 'attached' })
    await dismissOptionalButton(page, /^(继续|Continue)$/)
    await dismissOptionalButton(page, /^(稍后配置|Configure later|Skip for now)$/)
    await motionMenuTrigger(page).waitFor({ state: 'visible' })
  })

  afterAll(async () => {
    await browser?.close()
  })

  it('loads the client runtime and emits a transform-safe menu exit', async () => {
    await clearCapturedMotion(page)
    const trigger = motionModelTrigger(page)
    await trigger.click()
    const menu = page.getByRole('menu').first()
    await menu.waitFor({ state: 'visible' })

    const exitGhost = page.locator('[data-dsh-motion-ghost]').first()
    const attached = exitGhost.waitFor({ state: 'attached' })
    await trigger.click()
    await attached
    const calls = await capturedMotion(page)
    const menuMotion = calls.find(call => call.ghost && call.role === 'menu')
    expect(menuMotion).toBeDefined()
    expect(menuMotion?.duration).toBeGreaterThanOrEqual(120)
    expect(menuMotion?.duration).toBeLessThanOrEqual(160)
    expect(menuMotion?.keyframes.some(frame => 'translate' in frame)).toBe(true)
    expect(menuMotion?.keyframes.every(frame => !('transform' in frame))).toBe(true)
    expect(await exitGhost.getAttribute('aria-hidden')).toBe('true')
    expect(await exitGhost.getAttribute('inert')).not.toBeNull()
    await exitGhost.waitFor({ state: 'detached' })
  })

  it('through-fades model and reasoning pages inside one persistent menu', async () => {
    const trigger = motionModelTrigger(page)
    if (await trigger.count() === 0) return
    await trigger.click()
    const drillIn = page.getByRole('menuitem').first()
    await drillIn.waitFor({ state: 'visible' })
    await clearCapturedMotion(page)

    const pageGhost = page.locator('[data-dsh-motion-menu-page-ghost]').first()
    const attached = pageGhost.waitFor({ state: 'attached' })
    await drillIn.click()
    await attached
    const calls = await capturedMotion(page)
    expect(calls.some(call => call.menuPageGhost && call.keyframes.at(-1)?.opacity === 0)).toBe(true)
    expect(calls.some(call => !call.ghost && call.role === 'menu'
      && call.keyframes[0]?.opacity === 0)).toBe(true)
    await pageGhost.waitFor({ state: 'detached' })
    await trigger.click()
  })

  it('animates workspace group height and fades removed rows on collapse', async () => {
    const workspace = page.locator(
      '[data-slot="sidebar.workspaces"] [role="treeitem"][aria-expanded]',
    ).first()
    if (await workspace.count() === 0) return
    if (await workspace.getAttribute('aria-expanded') === 'true') {
      await workspace.click()
      await expect.poll(() => workspace.getAttribute('aria-expanded')).toBe('false')
      await page.waitForTimeout(260)
    }

    const collapsedRows = await page.locator(
      '[data-slot="sidebar.workspaces"] [role="treeitem"]',
    ).count()
    await clearCapturedMotion(page)
    await workspace.click()
    await expect.poll(() => workspace.getAttribute('aria-expanded')).toBe('true')
    const expandedRows = await page.locator(
      '[data-slot="sidebar.workspaces"] [role="treeitem"]',
    ).count()
    if (expandedRows <= collapsedRows) return
    await expect.poll(async () => (
      await capturedMotion(page)
    ).some(call => call.keyframes.some(frame => 'height' in frame))).toBe(true)
    await page.waitForTimeout(260)

    await clearCapturedMotion(page)
    const rowGhost = page.locator('[data-dsh-motion-disclosure-ghost]').first()
    const attached = rowGhost.waitFor({ state: 'attached' })
    await workspace.click()
    await attached
    expect(await rowGhost.getAttribute('aria-hidden')).toBe('true')
    await expect.poll(async () => (
      await capturedMotion(page)
    ).some(call => call.keyframes.some(frame => 'height' in frame))).toBe(true)
    await rowGhost.waitFor({ state: 'detached' })
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

    await page.setViewportSize({ width: 1440, height: 900 })
    const exitGhost = page.locator('[data-dsh-motion-ghost]').first()
    const exitAttached = exitGhost.waitFor({ state: 'attached' })
    await dialog.getByRole('button', { name: /^(关闭|Close)$/ }).click()
    await exitAttached
    await exitGhost.waitFor({ state: 'detached' })

    await clearCapturedMotion(page)
    await page.getByRole('button', { name: /^(设置|Settings)$/ }).click()
    await dialog.waitFor({ state: 'visible' })
    await expect.poll(async () => (
      await capturedMotion(page)
    ).some(call => call.role === 'dialog' && !call.ghost)).toBe(true)
    const settingsEntry = await capturedMotion(page)
    expect(settingsEntry.some(call => call.role === 'dialog'
      && !call.ghost && call.backdropFilter === 'none')).toBe(true)
    expect(settingsEntry.filter(call => call.nestedInDialog)).toEqual([])
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

    const dialogGhost = page.locator('[data-dsh-motion-ghost] [role="dialog"]').first()
    const attached = dialogGhost.waitFor({ state: 'attached' })
    await page.getByRole('button', { name: /^(关闭|Close)$/ }).click()
    await attached
    expect(await dialogGhost.getAttribute('aria-hidden')).toBeNull()
    expect(await dialogGhost.locator('..').getAttribute('aria-hidden')).toBe('true')
    const exitCalls = await capturedMotion(page)
    expect(exitCalls.some(call => call.role === 'dialog' && call.ghost
      && call.backdropFilter === 'none'
      && call.pointerEvents === 'none'
      && call.ghostPointerSafe)).toBe(true)
    await dialogGhost.waitFor({ state: 'detached' })
  })

  it('suppresses transient motion under prefers-reduced-motion', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await clearCapturedMotion(page)
    const trigger = motionMenuTrigger(page)
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
  const appeared = await button.waitFor({ state: 'visible', timeout: 2_000 })
    .then(() => true, () => false)
  if (appeared) await button.click()
}

async function clearCapturedMotion(page: Page): Promise<void> {
  await page.evaluate(() => { window.__DSH_MOTION_CALLS__ = [] })
}

async function capturedMotion(page: Page): Promise<CapturedMotion[]> {
  return page.evaluate(() => window.__DSH_MOTION_CALLS__ ?? [])
}

function motionMenuTrigger(page: Page) {
  return page.locator(
    'button[aria-label^="访问模式"], button[aria-label^="Access mode"]',
  ).first()
}

function motionModelTrigger(page: Page) {
  return page.locator(
    'button[aria-label*="选择模型"], button[aria-label*="Select model"]',
  ).first()
}
