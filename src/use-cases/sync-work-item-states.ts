import { deleteWorkspace, listWorkspaces, startWorkspace, stopWorkspace } from "../infrastructure/coder.ts"
import { PlaneRateLimitedError } from "../infrastructure/plane.ts"
import * as planeWorkItemRepository from "../repositories/plane-work-item-repository.ts"
import * as workItemWorkspaceRepository from "../repositories/work-item-workspace-repository.ts"
import * as planeProjectService from "../services/plane-project-service.ts"
import type { WorkItem, WorkItemWorkspace } from "../shared/types.ts"

const CLOSED_GROUPS = new Set(["completed", "cancelled"])

async function closeDescendants(item: WorkItem, items: WorkItem[]): Promise<void> {
  for (const descendant of planeWorkItemRepository.descendantsOf(item.id, items)) {
    if (CLOSED_GROUPS.has((await planeProjectService.stateGroup(descendant.stateId)) ?? "")) continue
    await planeWorkItemRepository.setState(descendant.id, item.stateId)
  }
}

async function deleteLinkedWorkspace(link: WorkItemWorkspace): Promise<void> {
  try {
    await deleteWorkspace(link.workspaceId)
  } catch (error) {
    if (!(error as Error).message.endsWith(": 404")) throw error
  }
  workItemWorkspaceRepository.markDeleted(link.itemId)
}

export async function syncWorkItemStates(items: WorkItem[]): Promise<void> {
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const workspaces = new Map((await listWorkspaces()).map((workspace) => [workspace.id, workspace]))
  for (const link of workItemWorkspaceRepository.findLinked()) {
    try {
      const item = itemsById.get(link.itemId)
      if (item && item.stateId === link.syncedStateId) continue
      const group = item ? await planeProjectService.stateGroup(item.stateId) : undefined
      if (!item || CLOSED_GROUPS.has(group ?? "")) {
        if (item) await closeDescendants(item, items)
        await deleteLinkedWorkspace(link)
        continue
      }
      const status = workspaces.get(link.workspaceId)?.status
      let syncedStateId = item.stateId
      if ((group === "started" || group === "unstarted") && status === "stopped") {
        await startWorkspace(link.workspaceId)
        workItemWorkspaceRepository.clearStopped(link.itemId)
      }
      if (group === "unstarted") {
        syncedStateId = await planeProjectService.stateIdByKey("in_progress")
        await planeWorkItemRepository.setState(item.id, syncedStateId)
      }
      if (group === "backlog" && status === "running") {
        await stopWorkspace(link.workspaceId)
        workItemWorkspaceRepository.markStopped(link.itemId)
      }
      workItemWorkspaceRepository.setSyncedState(link.itemId, syncedStateId)
    } catch (error) {
      if (error instanceof PlaneRateLimitedError) throw error
      console.error(`sync ${link.workspace}:`, error)
    }
  }
}
