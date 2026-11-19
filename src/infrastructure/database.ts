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
  CREATE TABLE IF NOT EXISTS owned_branches (
    repository TEXT NOT NULL,
    branch TEXT NOT NULL,
    item_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (repository, branch)
  );
  CREATE TABLE IF NOT EXISTS owned_pull_requests (
    repository TEXT NOT NULL,
    number INTEGER NOT NULL,
    item_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (repository, number)
  );
`)

const questionColumns = database.prepare("PRAGMA table_info(questions)").all() as { name: string }[]
if (!questionColumns.some((column) => column.name === "delivered_at")) {
  database.exec(
    "ALTER TABLE questions ADD COLUMN delivered_at TEXT; UPDATE questions SET delivered_at = answered_at WHERE answer IS NOT NULL",
  )
}
if (!questionColumns.some((column) => column.name === "superseded_at")) {
  database.exec("ALTER TABLE questions ADD COLUMN superseded_at TEXT")
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
  ["session_model", "TEXT NOT NULL DEFAULT ''"],
  ["synced_state_id", "TEXT"],
  ["deleted_at", "TEXT"],
]) {
  if (!linkColumns.has(column)) database.exec(`ALTER TABLE work_item_workspaces ADD COLUMN ${column} ${definition}`)
}

const groupColumns = new Set(
  (database.prepare("PRAGMA table_info(batch_groups)").all() as { name: string }[]).map((column) => column.name),
)
if (!groupColumns.has("model")) database.exec("ALTER TABLE batch_groups ADD COLUMN model TEXT NOT NULL DEFAULT ''")
