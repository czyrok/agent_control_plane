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
  CREATE TABLE IF NOT EXISTS batch_groups (
    item_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    skill TEXT NOT NULL,
    instructions TEXT NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY (item_id, position)
  );
  CREATE TABLE IF NOT EXISTS batch_group_items (
    item_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    member_id TEXT NOT NULL,
    PRIMARY KEY (item_id, member_id)
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
  ["branch", "TEXT NOT NULL DEFAULT ''"],
  ["phase", "TEXT NOT NULL DEFAULT 'single'"],
  ["current_group", "INTEGER"],
  ["session_revision", "INTEGER NOT NULL DEFAULT 0"],
  ["session_prompt", "TEXT NOT NULL DEFAULT ''"],
  ["synced_state_id", "TEXT"],
  ["deleted_at", "TEXT"],
]) {
  if (!linkColumns.has(column)) database.exec(`ALTER TABLE work_item_workspaces ADD COLUMN ${column} ${definition}`)
}
