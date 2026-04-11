import { AsyncLocalStorage } from "node:async_hooks"

type ContextValue = {
  workspaceID?: string
}

const storage = new AsyncLocalStorage<ContextValue>()

export const WorkspaceContext = {
  get workspaceID(): string | undefined {
    return storage.getStore()?.workspaceID
  },

  async provide<T>(input: {
    workspaceID?: string
    fn: () => Promise<T> | T
  }): Promise<T> {
    return storage.run({ workspaceID: input.workspaceID }, () => Promise.resolve(input.fn()))
  },
}
