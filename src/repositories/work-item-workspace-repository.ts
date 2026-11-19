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
  synced_state_id: string | null
  deleted_at: string | null
}

const statements = {
  insert: database.prepare(
    "INSERT OR REPLACE INTO work_item_workspaces (item_id, item_key, item_name, workspace, workspace_id, created_at, stopped_at, synced_state_id, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ),
  selectByItemId: database.prepare("SELECT * FROM work_item_workspaces WHERE item_id = ?"),
  selectByWorkspace: database.prepare("SELECT * FROM work_item_workspaces WHERE workspace = ? AND deleted_at IS NULL"),
  selectActive: database.prepare("SELECT * FROM work_item_workspaces WHERE stopped_at IS NULL"),
  selectLinked: database.prepare("SELECT * FROM work_item_workspaces WHERE deleted_at IS NULL"),
  updateStopped: database.prepare("UPDATE work_item_workspaces SET stopped_at = ? WHERE item_id = ?"),
  clearStopped: database.prepare("UPDATE work_item_workspaces SET stopped_at = NULL WHERE item_id = ?"),
  updateSyncedState: database.prepare("UPDATE work_item_workspaces SET synced_state_id = ? WHERE item_id = ?"),
  updateDeleted: database.prepare("UPDATE work_item_workspaces SET deleted_at = ? WHERE item_id = ?"),
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
    syncedStateId: row.synced_state_id,
    deletedAt: row.deleted_at,
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
    link.syncedStateId,
    link.deletedAt,
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

export function findLinked(): WorkItemWorkspace[] {
  return (statements.selectLinked.all() as Row[]).map(toLink)
}

export function markStopped(itemId: string): void {
  statements.updateStopped.run(new Date().toISOString(), itemId)
}

export function clearStopped(itemId: string): void {
  statements.clearStopped.run(itemId)
}

export function setSyncedState(itemId: string, stateId: string): void {
  statements.updateSyncedState.run(stateId, itemId)
}

export function markDeleted(itemId: string): void {
  statements.updateDeleted.run(new Date().toISOString(), itemId)
}
