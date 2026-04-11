import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import { execSync } from "node:child_process"
import desktopPlugin from "./vite"

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./dist/**",
          filesToDeleteAfterUpload: "./dist/**/*.map",
        },
      })
    : false

function git(command: string, fallback: string) {
  try {
    return execSync(command, { encoding: "utf8" }).trim() || fallback
  } catch {
    return fallback
  }
}

const gitBranch = git("git rev-parse --abbrev-ref HEAD", "unknown")
const gitRevision = git("git rev-parse --short HEAD", "unknown")
const gitRevisionNumber = git("git rev-list --count --first-parent HEAD", "unknown")

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_GIT_BRANCH": JSON.stringify(gitBranch),
    "import.meta.env.VITE_APP_GIT_REVISION": JSON.stringify(gitRevision),
    "import.meta.env.VITE_APP_GIT_REVISION_NUMBER": JSON.stringify(gitRevisionNumber),
  },
  plugins: [desktopPlugin, sentry] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
