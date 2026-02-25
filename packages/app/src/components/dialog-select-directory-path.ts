export function cleanInput(value: string) {
  const first = (value ?? "").split(/\r?\n/)[0] ?? ""
  return first.replace(/[\u0000-\u001F\u007F]/g, "").trim()
}

export function normalizePath(input: string) {
  const value = input.replaceAll("\\", "/")
  if (value.startsWith("//") && !value.startsWith("///")) return "//" + value.slice(2).replace(/\/+/g, "/")
  return value.replace(/\/+/g, "/")
}

export function normalizeDriveRoot(input: string) {
  const value = normalizePath(input)
  if (/^[A-Za-z]:$/.test(value)) return value + "/"
  return value
}

export function trimTrailing(input: string) {
  const value = normalizeDriveRoot(input)
  if (value === "/") return value
  if (value === "//") return value
  if (/^[A-Za-z]:\/$/.test(value)) return value
  return value.replace(/\/+$/, "")
}

export function joinPath(base: string | undefined, rel: string) {
  const left = trimTrailing(base ?? "")
  const right = trimTrailing(rel).replace(/^\/+/, "")
  if (!left) return right
  if (!right) return left
  if (left.endsWith("/")) return left + right
  return left + "/" + right
}

export function rootOf(input: string) {
  const value = normalizeDriveRoot(input)
  if (value.startsWith("//")) return "//"
  if (value.startsWith("/")) return "/"
  if (/^[A-Za-z]:\//.test(value)) return value.slice(0, 3)
  return ""
}

export function parentOf(input: string) {
  const value = trimTrailing(input)
  if (value === "/") return value
  if (value === "//") return value
  if (/^[A-Za-z]:\/$/.test(value)) return value

  const index = value.lastIndexOf("/")
  if (index <= 0) return "/"
  if (index === 2 && /^[A-Za-z]:/.test(value)) return value.slice(0, 3)
  return value.slice(0, index)
}

export function tildeOf(absolute: string, home: string) {
  const full = trimTrailing(absolute)
  if (!home) return ""

  const hn = trimTrailing(home)
  const lc = full.toLowerCase()
  const hc = hn.toLowerCase()
  if (lc === hc) return "~"
  if (lc.startsWith(hc + "/")) return "~" + full.slice(hn.length)
  return ""
}
