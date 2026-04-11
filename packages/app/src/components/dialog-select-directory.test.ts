import { describe, expect, test } from "bun:test"
import { cleanInput, normalizeDriveRoot, normalizePath, rootOf, trimTrailing } from "./dialog-select-directory-path"

describe("dialog select directory path helpers", () => {
  test("cleans control characters and extra lines", () => {
    expect(cleanInput("  D:\\\\repo\\\nignored")).toBe("D:\\\\repo\\")
  })

  test("normalizes windows separators", () => {
    expect(normalizePath("D:\\\\repo\\\\demo")).toBe("D:/repo/demo")
  })

  test("normalizes drive roots", () => {
    expect(normalizeDriveRoot("D:")).toBe("D:/")
    expect(normalizeDriveRoot("d:")).toBe("d:/")
  })

  test("trims trailing separators but keeps roots", () => {
    expect(trimTrailing("D:/repo///")).toBe("D:/repo")
    expect(trimTrailing("D:/")).toBe("D:/")
    expect(trimTrailing("/")).toBe("/")
  })

  test("detects root for slash and drive paths", () => {
    expect(rootOf("D:\\\\repo")).toBe("D:/")
    expect(rootOf("/tmp/demo")).toBe("/")
    expect(rootOf("workspace/demo")).toBe("")
  })
})
