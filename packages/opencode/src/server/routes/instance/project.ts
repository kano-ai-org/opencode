import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Instance } from "@/project/instance"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import z from "zod"
import { ProjectID } from "@/project/schema"
import { ProjectTable } from "@/project/project.sql"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { getBootstrapRunEffect } from "@/effect/app-runtime"
import { jsonRequest, runRequest } from "./trace"

const WorkspaceToggles = z.object({
  version: z.number().int().nonnegative(),
  toggles: z.record(z.string(), z.boolean()),
})

export const ProjectRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List all projects",
        description: "Get a list of projects that have been opened with OpenCode.",
        operationId: "project.list",
        responses: {
          200: {
            description: "List of projects",
            content: {
              "application/json": {
                schema: resolver(Project.Info.zod.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const projects = Project.list()
        return c.json(projects)
      },
    )
    .get(
      "/current",
      describeRoute({
        summary: "Get current project",
        description: "Retrieve the currently active project that OpenCode is working with.",
        operationId: "project.current",
        responses: {
          200: {
            description: "Current project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info.zod),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Instance.project)
      },
    )
    .get(
      "/:projectID/workspace-toggles",
      describeRoute({
        summary: "Get project workspace toggles",
        description: "Return persisted sidebar workspace visibility toggles for a project.",
        operationId: "project.workspaceToggles.get",
        responses: {
          200: {
            description: "Workspace toggle state",
            content: {
              "application/json": {
                schema: resolver(WorkspaceToggles),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ projectID: ProjectID.zod })),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        const row = Database.use((db) =>
          db
            .select({
              toggles: ProjectTable.workspace_toggles,
              version: ProjectTable.workspace_toggles_version,
            })
            .from(ProjectTable)
            .where(eq(ProjectTable.id, projectID))
            .get(),
        )
        if (!row) return c.json({ message: `Project not found: ${projectID}` }, 404)
        return c.json({ toggles: row.toggles ?? {}, version: row.version ?? 0 })
      },
    )
    .patch(
      "/:projectID/workspace-toggles",
      describeRoute({
        summary: "Update project workspace toggles",
        description: "Persist sidebar workspace visibility toggles using optimistic concurrency.",
        operationId: "project.workspaceToggles.update",
        responses: {
          200: {
            description: "Updated workspace toggle state",
            content: {
              "application/json": {
                schema: resolver(WorkspaceToggles),
              },
            },
          },
          409: {
            description: "Workspace toggle version conflict; response contains current state.",
            content: {
              "application/json": {
                schema: resolver(WorkspaceToggles),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ projectID: ProjectID.zod })),
      validator("json", WorkspaceToggles),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        const body = c.req.valid("json")
        const current = Database.use((db) =>
          db
            .select({
              toggles: ProjectTable.workspace_toggles,
              version: ProjectTable.workspace_toggles_version,
            })
            .from(ProjectTable)
            .where(eq(ProjectTable.id, projectID))
            .get(),
        )
        if (!current) return c.json({ message: `Project not found: ${projectID}` }, 404)
        if ((current.version ?? 0) !== body.version) {
          return c.json({ toggles: current.toggles ?? {}, version: current.version ?? 0 }, 409)
        }
        const nextVersion = body.version + 1
        const updated = Database.use((db) =>
          db
            .update(ProjectTable)
            .set({
              workspace_toggles: body.toggles,
              workspace_toggles_version: nextVersion,
              time_updated: Date.now(),
            })
            .where(eq(ProjectTable.id, projectID))
            .returning({
              toggles: ProjectTable.workspace_toggles,
              version: ProjectTable.workspace_toggles_version,
            })
            .get(),
        )
        return c.json({ toggles: updated?.toggles ?? body.toggles, version: updated?.version ?? nextVersion })
      },
    )
    .post(
      "/git/init",
      describeRoute({
        summary: "Initialize git repository",
        description: "Create a git repository for the current project and return the refreshed project info.",
        operationId: "project.initGit",
        responses: {
          200: {
            description: "Project information after git initialization",
            content: {
              "application/json": {
                schema: resolver(Project.Info.zod),
              },
            },
          },
        },
      }),
      async (c) => {
        const dir = Instance.directory
        const prev = Instance.project
        const next = await runRequest(
          "ProjectRoutes.initGit",
          c,
          Project.Service.use((svc) => svc.initGit({ directory: dir, project: prev })),
        )
        if (next.id === prev.id && next.vcs === prev.vcs && next.worktree === prev.worktree) return c.json(next)
        await InstanceStore.reloadInstance({ directory: dir, worktree: dir, project: next, init: await getBootstrapRunEffect() })
        return c.json(next)
      },
    )
    .patch(
      "/:projectID",
      describeRoute({
        summary: "Update project",
        description: "Update project properties such as name, icon, and commands.",
        operationId: "project.update",
        responses: {
          200: {
            description: "Updated project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info.zod),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ projectID: ProjectID.zod })),
      validator("json", Project.UpdateInput.omit({ projectID: true })),
      async (c) =>
        jsonRequest("ProjectRoutes.update", c, function* () {
          const projectID = c.req.valid("param").projectID
          const body = c.req.valid("json")
          const svc = yield* Project.Service
          return yield* svc.update({ ...body, projectID })
        }),
    ),
)
