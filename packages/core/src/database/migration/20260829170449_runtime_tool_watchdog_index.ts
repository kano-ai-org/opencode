import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260829170449_runtime_tool_watchdog_index",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE INDEX \`part_runtime_tool_updated_idx\` ON \`part\` (\`time_updated\`) WHERE json_extract("part"."data", '$.type') = 'tool' and json_extract("part"."data", '$.state.status') in ('pending', 'running');`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
