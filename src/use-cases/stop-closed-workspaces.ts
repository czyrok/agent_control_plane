import { stopWorkspace } from "../infrastructure/coder.ts"
import * as workItemWorkspaceRepository from "../repositories/work-item-workspace-repository.ts"
import * as planeProjectService from "../services/plane-project-service.ts"
import type { WorkItem } from "../shared/types.ts"

const CLOSED_GROUPS = new Set(["completed", "cancelled"])

export async function stopClosedWorkspaces(items: WorkItem[]): Promise<void> {
  const itemsById = new Map(items.map((item) => [item.id, item]))
  for (const link of workItemWorkspaceRepository.findActive()) {
    try {
      const item = itemsById.get(link.itemId)
      if (item && !CLOSED_GROUPS.has((await planeProjectService.stateGroup(item.stateId)) ?? "")) continue
      await stopWorkspace(link.workspaceId)
      workItemWorkspaceRepository.markStopped(link.itemId)
    } catch (error) {
      console.error(`stop ${link.workspace}:`, error)
    }
  }
}
