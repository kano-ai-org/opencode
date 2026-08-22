import { NodeHttpServer } from "@effect/platform-node"
import { ProjectV2 } from "@opencode-ai/core/project"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Option, Ref } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Installation } from "../../src/installation"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import type { InstanceContext } from "../../src/project/instance-context"
import { InstanceStore } from "../../src/project/instance-store"
import { SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { ServerAuth } from "../../src/server/auth"
import { RootHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { controlHandlers } from "../../src/server/routes/instance/httpapi/handlers/control"
import { controlPlaneHandlers } from "../../src/server/routes/instance/httpapi/handlers/control-plane"
import { globalHandlers } from "../../src/server/routes/instance/httpapi/handlers/global"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error"
import { testEffect } from "../lib/effect"

const presetBusy = Ref.makeUnsafe(false)
const presetContext: InstanceContext = {
  directory: "/busy",
  worktree: "/busy",
  project: {
    id: ProjectV2.ID.make("preset-busy"),
    worktree: "/busy",
    time: { created: 0, updated: 0 },
    sandboxes: [],
  },
}

const apiLayer = HttpRouter.serve(
  HttpApiBuilder.layer(RootHttpApi).pipe(
    Layer.provide([controlHandlers, controlPlaneHandlers, globalHandlers]),
    Layer.provide([authorizationLayer, schemaErrorLayer]),
    // Raw HttpApi routes expose an opaque handler context at the request boundary.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    HttpRouter.provideRequest(Layer.succeedContext(Context.empty() as Context.Context<unknown>)),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide(Layer.mock(Auth.Service)({})),
  Layer.provide(Layer.mock(Config.Service)({})),
  Layer.provide(
    Layer.mock(InstanceStore.Service)({
      list: () => Ref.get(presetBusy).pipe(Effect.map((busy) => (busy ? [presetContext] : []))),
    }),
  ),
  Layer.provide(Layer.mock(MoveSession.Service)({})),
  Layer.provide(
    Layer.mock(SessionStatus.Service)({
      list: () =>
        Ref.get(presetBusy).pipe(
          Effect.map((busy) =>
            busy
              ? new Map([[SessionID.make("ses_preset_busy"), { type: "busy" as const }]])
              : new Map<SessionID, SessionStatus.Info>(),
          ),
        ),
    }),
  ),
  Layer.provide(
    Layer.mock(Installation.Service)({
      method: () => Effect.succeed("npm"),
      latest: () => Effect.succeed("9.9.9"),
      upgrade: () => Effect.void,
    }),
  ),
  Layer.provide(ServerAuth.Config.configLayer({ password: Option.none(), username: "opencode" })),
)
const it = testEffect(apiLayer)

describe("global HttpApi", () => {
  it.live("rejects model preset reload while a session is busy", () =>
    Effect.gen(function* () {
      yield* Ref.set(presetBusy, true)
      const response = yield* HttpClientRequest.post(GlobalPaths.configPresetApply).pipe(
        HttpClientRequest.setBody(HttpBody.jsonUnsafe({ id: "openai" })),
        HttpClient.execute,
      )

      expect(response.status).toBe(409)
      expect(yield* response.json).toMatchObject({
        _tag: "ConflictError",
        message:
          "Cannot switch the model config preset while sessions are running. Wait for them to finish and try again.",
        resource: "model-config-preset",
      })
    }).pipe(Effect.ensuring(Ref.set(presetBusy, false))),
  )

  it.live("upgrades to latest when the request body is omitted", () =>
    Effect.gen(function* () {
      const response = yield* HttpClient.post(GlobalPaths.upgrade)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({ success: true, version: "9.9.9" })
    }),
  )

  it.live("rejects malformed upgrade payloads", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(GlobalPaths.upgrade).pipe(
        HttpClientRequest.setBody(HttpBody.text("{", "application/json")),
        HttpClient.execute,
      )

      expect(response.status).toBe(400)
      expect(yield* response.json).toEqual({ success: false, error: "Invalid request body" })
    }),
  )
})
