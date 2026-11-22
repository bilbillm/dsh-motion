// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

describe('Harness package metadata', () => {
  it('declares both client and bundle faces', () => {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      exports: Record<string, unknown>
      engines: Record<string, string>
      peerDependencies: Record<string, string>
      dsh: { bundle: { patch: string }; client: { inject: string[]; platform: string } }
    }
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.exports).toHaveProperty('./cordis.patch.yml')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    // Empty inject is valid in both 0.1.x and 0.2.x; 0.1.x's client-runtime
    // package no longer exists in 0.2.x, so the roster must not name it.
    expect(manifest.dsh.client).toEqual({ inject: [], platform: 'web' })
    expect(manifest.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-client-runtime')
    // Boot compatibility is checked against engines.dsh in 0.2.x; the range
    // intentionally spans both the 0.1.x and 0.2.x release lines.
    expect(manifest.engines.dsh).toBe('>=0.1.0-rc.5 <0.3.0')
  })

  it('adds one stable Loader row through a parseable patch', () => {
    const patch = parse(readFileSync(resolve('cordis.patch.yml'), 'utf8')) as unknown
    expect(patch).toEqual([{
      insert: [{ id: 'dsh-motion', name: '@dsh-external/dsh-motion' }],
    }])
  })
})
