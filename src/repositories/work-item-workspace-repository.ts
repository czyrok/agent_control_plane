import { database } from "../infrastructure/database.ts"
import type { WorkItemWorkspace } from "../shared/types.ts"

type Row = {
  item_id: string
  item_key: string
  item_name: string
  workspace: string
  workspace_id: string
  created_at: string
  stopped_at: string | null
}

const statements = {
  insert: database.prepare(
    "INSERT INTO work_item_workspaces (item_id, item_key, item_name, workspace, workspace_id, created_at, stopped_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ),
  selectByItemId: database.prepare("SELECT * FROM work_item_workspaces WHERE item_id = ?"),
  selectByWorkspace: database.prepare("SELECT * FROM work_item_workspaces WHERE workspace = ?"),
  selectActive: database.prepare("SELECT * FROM work_item_workspaces WHERE stopped_at IS NULL"),
  updateStopped: database.prepare("UPDATE work_item_workspaces SET stopped_at = ? WHERE item_id = ?"),
}

function toLink(row: Row): WorkItemWorkspace {
  return {
    itemId: row.item_id,
    itemKey: row.item_key,
    itemName: row.item_name,
    workspace: row.workspace,
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
    stoppedAt: row.stopped_at,
  }
}

export function insert(link: WorkItemWorkspace): void {
  statements.insert.run(
    link.itemId,
    link.itemKey,
    link.itemName,
    link.workspace,
    link.workspaceId,
    link.createdAt,
    link.stoppedAt,
  )
}

export function findByItemId(itemId: string): WorkItemWorkspace | undefined {
  const row = statements.selectByItemId.get(itemId) as Row | undefined
  return row && toLink(row)
}

export function findByWorkspace(workspace: string): WorkItemWorkspace | undefined {
  const row = statements.selectByWorkspace.get(workspace) as Row | undefined
  return row && toLink(row)
}

export function findActive(): WorkItemWorkspace[] {
  return (statements.selectActive.all() as Row[]).map(toLink)
}

export function markStopped(itemId: string): void {
  statements.updateStopped.run(new Date().toISOString(), itemId)
}
