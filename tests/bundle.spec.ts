import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

interface Handoff {
  readonly id: string
  readonly factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

type LoaderWindow = Window & {
  __ModuleLoader__?: { load(handoff: Handoff): void }
}

afterEach(() => {
  delete (window as LoaderWindow).__ModuleLoader__
  for (const style of document.querySelectorAll('[data-dsh-motion-style]')) style.remove()
})
describe('built client bundle', () => {
  it('registers with the Harness module loader and exposes the client plugin', () => {
    const code = readFileSync(resolve('lib/client.js'), 'utf8')
    let handoff: Handoff | undefined
    ;(window as LoaderWindow).__ModuleLoader__ = { load: value => { handoff = value } }

    // Deliberate execution of the built registration artifact.
    new Function(code)()
    expect(handoff?.id).toBe('@dsh-external/dsh-motion')
    const exports = handoff?.factory((specifier) => {
      throw new Error(`unexpected external require: ${specifier}`)
    })
    expect(exports?.apply).toBeTypeOf('function')
    expect(exports?.inject).toEqual([])
    expect(exports?.MotionRuntime).toBeTypeOf('function')
  })
})
