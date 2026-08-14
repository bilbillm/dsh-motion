// @vitest-environment node
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('built Node half', () => {
  it('loads without browser globals and exposes only a no-op apply', async () => {
    expect('window' in globalThis).toBe(false)
    const module = await import(pathToFileURL(resolve('lib/index.js')).href)
    expect(module.apply).toBeTypeOf('function')
    expect(module.apply()).toBeUndefined()
  })
})
