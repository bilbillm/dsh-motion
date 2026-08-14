import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'

afterEach(() => {
  document.body.innerHTML = ''
  for (const style of document.querySelectorAll('[data-dsh-motion-style]')) style.remove()
})

describe('client lifecycle adapter', () => {
  it('installs through one Cordis effect and disposes the runtime', () => {
    let disposer: (() => void) | undefined
    const effect = vi.fn((execute: () => () => void, _label?: string) => {
      disposer = execute()
      return { dispose: async () => {} }
    })
    apply({ effect } as unknown as ClientContext)

    expect(inject).toEqual([])
    expect(effect).toHaveBeenCalledOnce()
    expect(effect.mock.calls[0]?.[1]).toBe('dsh-motion: semantic motion runtime')
    expect(document.querySelector('[data-dsh-motion-style]')).not.toBeNull()
    disposer?.()
    expect(document.querySelector('[data-dsh-motion-style]')).toBeNull()
  })
})
