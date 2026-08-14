export interface MutableMediaQuery {
  readonly query: MediaQueryList
  setMatches(value: boolean): void
  readonly add: ReturnType<typeof vi.fn>
  readonly remove: ReturnType<typeof vi.fn>
}
/** Small live MediaQueryList fixture shared by policy/runtime tests. */
export function mutableMediaQuery(initial: boolean): MutableMediaQuery {
  let matches = initial
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const add = vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
    if (typeof listener === 'function') listeners.add(listener as (event: MediaQueryListEvent) => void)
  })
  const remove = vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
    if (typeof listener === 'function') listeners.delete(listener as (event: MediaQueryListEvent) => void)
  })
  const legacyAdd = vi.fn((listener: (event: MediaQueryListEvent) => void) => { listeners.add(listener) })
  const legacyRemove = vi.fn((listener: (event: MediaQueryListEvent) => void) => { listeners.delete(listener) })

  const query = {
    get matches() { return matches },
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: add,
    removeEventListener: remove,
    addListener: legacyAdd,
    removeListener: legacyRemove,
    dispatchEvent: () => true,
  } as unknown as MediaQueryList

  return {
    query,
    add,
    remove,
    setMatches(value: boolean) {
      matches = value
      const event = { matches, media: query.media } as MediaQueryListEvent
      for (const listener of listeners) listener(event)
    },
  }
}

export async function mutationTurn(): Promise<void> {
  await new Promise<void>(resolve => { setTimeout(resolve, 0) })
}
