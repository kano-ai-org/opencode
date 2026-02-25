import { accessSync, constants } from "node:fs"
import path from "node:path"

function canExecute(file: string) {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function candidates(cmd: string, pathExt: string[]) {
  if (path.extname(cmd)) return [cmd]
  if (process.platform !== "win32") return [cmd]
  return [cmd, ...pathExt.map((ext) => `${cmd}${ext}`)]
}

export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const source = env ?? process.env
  const pathValue = source.PATH ?? ""
  const pathExt =
    process.platform === "win32"
      ? (source.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .map((ext) => ext.trim())
          .filter(Boolean)
      : []

  const hasSeparator = cmd.includes("/") || cmd.includes("\\")
  if (hasSeparator || path.isAbsolute(cmd)) {
    for (const candidate of candidates(cmd, pathExt)) {
      if (canExecute(candidate)) return candidate
    }
    return null
  }

  for (const entry of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const candidate of candidates(path.join(entry, cmd), pathExt)) {
      if (canExecute(candidate)) return candidate
    }
  }

  return null
}
