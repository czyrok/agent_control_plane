export type WorkItem = {
  id: string
  sequenceId: number
  key: string
  name: string
  description: string
  stateId: string
  parentId: string | null
  labelIds: string[]
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
  syncedStateId: string | null
  deletedAt: string | null
}

export type Question = {
  id: string
  itemId: string
  workspace: string
  createdAt: string
  answer: string | null
  answeredAt: string | null
  deliveredAt: string | null
}
