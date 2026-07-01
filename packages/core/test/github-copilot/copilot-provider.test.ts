import { expect, mock, test } from "bun:test"
import { createOpenaiCompatible } from "../../src/github-copilot/copilot-provider"

test("Copilot responses SDK sends the chat integration headers", async () => {
  let headers: unknown
  const provider = createOpenaiCompatible({
    apiKey: "token",
    baseURL: "https://api.githubcopilot.com",
    name: "github-copilot",
    fetch: mock(async (_input, init) => {
      headers = init?.headers
      throw new Error("stop after headers")
    }) as unknown as typeof fetch,
  })

  await expect(
    provider.responses("gpt-5.4").doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    }),
  ).rejects.toThrow("stop after headers")

  const requestHeaders = new Headers(headers as Headers)
  expect(requestHeaders.get("Copilot-Integration-Id")).toBe("vscode-chat")
  expect(requestHeaders.get("X-GitHub-Api-Version")).toBe("2026-06-01")
})
