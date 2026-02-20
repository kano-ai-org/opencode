import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

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
                schema: resolver(Project.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const projects = await Project.list()
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
                schema: resolver(Project.Info),
              },
            },
          },
        },
      }),
      validator("query", z.object({ directory: z.string().optional() })),
      async (c) => {
        const directory = c.req.valid("query").directory
        if (directory) {
          const { project } = await Project.fromDirectory(directory)
          return c.json(project)
        }
        return c.json(Instance.project)
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
                schema: resolver(Project.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ projectID: z.string() })),
      validator("json", Project.update.schema.omit({ projectID: true })),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        const body = c.req.valid("json")
        const project = await Project.update({ ...body, projectID })
        return c.json(project)
      },
    )
    .delete(
      "/:projectID",
      describeRoute({
        summary: "Delete project",
        description: "Delete a project and cascade delete dependent data such as sessions.",
        operationId: "project.delete",
        responses: {
          200: {
            description: "Project deleted",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ projectID: z.string() })),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        await Project.remove({ projectID })
        return c.json(true)
      },
    )
    .get(
      "/:projectID/workspace-toggles",
      describeRoute({
        summary: "Get workspace toggles",
        description: "Get the persisted workspace visibility toggles for a project.",
        operationId: "project.workspaceToggles",
        responses: {
          200: {
            description: "Workspace toggle state",
            content: {
              "application/json": {
                schema: resolver(Project.WorkspaceToggles),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ projectID: z.string() })),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        return c.json(Project.getWorkspaceToggles(projectID))
      },
    )
    .patch(
      "/:projectID/workspace-toggles",
      describeRoute({
        summary: "Update workspace toggles",
        description: "Update persisted workspace visibility toggles for a project.",
        operationId: "project.workspaceTogglesPatch",
        responses: {
          200: {
            description: "Workspace toggle state after update",
            content: {
              "application/json": {
                schema: resolver(Project.WorkspaceToggles),
              },
            },
          },
          409: {
            description: "Conflict due to stale version",
            content: {
              "application/json": {
                schema: resolver(Project.WorkspaceToggles),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ projectID: z.string() })),
      validator("json", Project.WorkspaceToggles),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        const body = c.req.valid("json")
        const result = await Project.updateWorkspaceToggles({
          projectID,
          version: body.version,
          toggles: body.toggles,
        })
        return c.json(result.data, result.status)
      },
    ),
)
