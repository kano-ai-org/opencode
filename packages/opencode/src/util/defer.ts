export function defer<T extends () => void | Promise<void>>(fn: T): {
  [Symbol.dispose]: () => void
  [Symbol.asyncDispose]: () => Promise<void>
} {
  return {
    [Symbol.dispose]() {
      fn()
    },
    [Symbol.asyncDispose]() {
      return Promise.resolve(fn())
    },
  } as any
}
