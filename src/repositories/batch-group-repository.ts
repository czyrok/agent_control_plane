import { database } from "../infrastructure/database.ts"
import type { BatchGroup, BatchGroupStatus } from "../shared/types.ts"

type Row = {
  item_id: string
  position: number
  name: string
  skill: string
  instructions: string
  model: string
  status: BatchGroupStatus
}

const statements = {
  insertGroup: database.prepare(
    "INSERT INTO batch_groups (item_id, position, name, skill, instructions, model, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
  ),
  insertMember: database.prepare("INSERT INTO batch_group_items (item_id, position, member_id) VALUES (?, ?, ?)"),
  selectGroups: database.prepare("SELECT * FROM batch_groups WHERE item_id = ? ORDER BY position"),
  selectMembers: database.prepare("SELECT member_id FROM batch_group_items WHERE item_id = ? AND position = ?"),
  updateStatus: database.prepare("UPDATE batch_groups SET status = ? WHERE item_id = ? AND position = ?"),
  deleteGroups: database.prepare("DELETE FROM batch_groups WHERE item_id = ?"),
  deleteMembers: database.prepare("DELETE FROM batch_group_items WHERE item_id = ?"),
}

function toGroup(row: Row): BatchGroup {
  const members = statements.selectMembers.all(row.item_id, row.position) as { member_id: string }[]
  return {
    itemId: row.item_id,
    position: row.position,
    name: row.name,
    skill: row.skill,
    instructions: row.instructions,
    model: row.model,
    status: row.status,
    memberIds: members.map((member) => member.member_id),
  }
}

export function clear(itemId: string): void {
  statements.deleteGroups.run(itemId)
  statements.deleteMembers.run(itemId)
}

export function replace(
  itemId: string,
  groups: { name: string; skill: string; instructions: string; model: string; memberIds: string[] }[],
): void {
  database.exec("BEGIN")
  try {
    clear(itemId)
    groups.forEach((group, position) => {
      statements.insertGroup.run(itemId, position, group.name, group.skill, group.instructions, group.model)
      for (const memberId of group.memberIds) statements.insertMember.run(itemId, position, memberId)
    })
    database.exec("COMMIT")
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
}

export function listByItem(itemId: string): BatchGroup[] {
  return (statements.selectGroups.all(itemId) as Row[]).map(toGroup)
}

export function markStatus(itemId: string, position: number, status: BatchGroupStatus): void {
  statements.updateStatus.run(status, itemId, position)
}
