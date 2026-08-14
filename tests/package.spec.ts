// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

describe('Harness package metadata', () => {
  it('declares both client and bundle faces', () => {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      exports: Record<string, unknown>
      dsh: { bundle: { patch: string }; client: { inject: string[]; platform: string } }
    }
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.exports).toHaveProperty('./cordis.patch.yml')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.client).toEqual({
      inject: ['@deepseek-ai/dsh-client-runtime'],
      platform: 'web',
    })
  })

  it('adds one stable Loader row through a parseable patch', () => {
    const patch = parse(readFileSync(resolve('cordis.patch.yml'), 'utf8')) as unknown
    expect(patch).toEqual([{
      insert: [{ id: 'dsh-motion', name: '@dsh-external/dsh-motion' }],
    }])
  })
})
