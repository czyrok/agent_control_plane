import { DatabaseSync } from "node:sqlite"

export const database = new DatabaseSync(process.env.DATABASE_PATH ?? "control_plane.db")

database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS work_item_workspaces (
    item_id TEXT PRIMARY KEY,
    item_key TEXT NOT NULL,
    item_name TEXT NOT NULL,
    workspace TEXT NOT NULL UNIQUE,
    workspace_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    stopped_at TEXT
  );
  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    workspace TEXT NOT NULL,
    created_at TEXT NOT NULL,
    answer TEXT,
    answered_at TEXT,
    delivered_at TEXT
  );
`)

const questionColumns = database.prepare("PRAGMA table_info(questions)").all() as { name: string }[]
if (!questionColumns.some((column) => column.name === "delivered_at")) {
  database.exec(
    "ALTER TABLE questions ADD COLUMN delivered_at TEXT; UPDATE questions SET delivered_at = answered_at WHERE answer IS NOT NULL",
  )
}

const linkColumns = new Set(
  (database.prepare("PRAGMA table_info(work_item_workspaces)").all() as { name: string }[]).map((column) => column.name),
)
for (const [column, definition] of [
  ["synced_state_id", "TEXT"],
  ["deleted_at", "TEXT"],
]) {
  if (!linkColumns.has(column)) database.exec(`ALTER TABLE work_item_workspaces ADD COLUMN ${column} ${definition}`)
}
