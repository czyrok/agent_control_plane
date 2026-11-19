export type WorkItem = {
  id: string
  sequenceId: number
  key: string
  name: string
  description: string
  stateId: string
  parentId: string | null
  labelIds: string[]
  assigneeIds: string[]
}

export type PlaneState = { id: string; name: string; group: string; externalId: string | null }

export type PlaneLabel = { id: string; name: string; parentId: string | null; externalId: string | null }

export type PlaneComment = { id: string; text: string; externalSource: string | null; createdAt: string }

export type WorkItemWorkspace = {
  itemId: string
  itemKey: string
  itemName: string
  workspace: string
  workspaceId: string
  createdAt: string
  stoppedAt: string | null
  branch: string
  phase: SessionPhase
  currentGroup: number | null
  sessionRevision: number
  sessionPrompt: string
  syncedStateId: string | null
  deletedAt: string | null
}

export type SessionPhase = "single" | "planning" | "groups" | "pull_requests" | "done"

export type BatchGroupStatus = "pending" | "in_progress" | "finished"

export type BatchGroup = {
  itemId: string
  position: number
  name: string
  skill: string
  instructions: string
  status: BatchGroupStatus
  memberIds: string[]
}

export type BatchGroupInput = { name: string; skill: string; instructions: string; items: string[] }

export type Question = {
  id: string
  itemId: string
  workspace: string
  createdAt: string
  answer: string | null
  answeredAt: string | null
  deliveredAt: string | null
}
