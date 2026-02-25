import path from "path"
import { Global } from "."

const file = path.join(Global.Path.state, "instance-id")

let value: string | undefined

const normalize = (input: string) => input.trim()

export const InstanceID = {
  async get() {
    if (value) return value

    const existing = await Bun.file(file)
      .text()
      .then(normalize)
      .catch(() => "")
    if (existing) {
      value = existing
      return value
    }

    const next = crypto.randomUUID()
    await Bun.file(file).write(`${next}\n`)
    value = next
    return value
  },
  path: file,
}
