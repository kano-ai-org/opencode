export function normalizeProjectPath(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return ""

  const value = trimmed.replaceAll("\\", "/")
  const normalized = value.startsWith("//") && !value.startsWith("///")
    ? "//" + value.slice(2).replace(/\/+/g, "/")
    : value.replace(/\/+/g, "/")

  if (/^[A-Za-z]:$/.test(normalized)) return normalized + "/"
  return normalized
}