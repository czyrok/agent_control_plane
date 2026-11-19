import * as planeWorkItemRepository from "../repositories/plane-work-item-repository.ts"
import * as planeProjectService from "../services/plane-project-service.ts"
import type { WorkItem } from "../shared/types.ts"

export type WorkItemStats = { total: number; todo: number; started: number; done: number }

type CycleMembership = { currentItemIds: Set<string>; cycledItemIds: Set<string>; loadedAt: number }

const CYCLE_MEMBERSHIP_LIFETIME_MILLISECONDS = 300_000
const COUNTED_GROUPS: Record<string, "todo" | "started" | "done"> = {
  unstarted: "todo",
  started: "started",
  completed: "done",
}

let membership: CycleMembership | undefined
let latest: WorkItemStats | undefined

async function loadCycleMembership(): Promise<CycleMembership> {
  if (membership && Date.now() - membership.loadedAt < CYCLE_MEMBERSHIP_LIFETIME_MILLISECONDS) return membership
  const currentCycleId = await planeWorkItemRepository.findCurrentCycleId()
  const currentItemIds = new Set<string>()
  const cycledItemIds = new Set<string>()
  for (const cycleId of await planeWorkItemRepository.listCycleIds()) {
    for (const itemId of await planeWorkItemRepository.listCycleItemIds(cycleId)) {
      cycledItemIds.add(itemId)
      if (cycleId === currentCycleId) currentItemIds.add(itemId)
    }
  }
  membership = { currentItemIds, cycledItemIds, loadedAt: Date.now() }
  return membership
}

export async function recordWorkItemStats(items: WorkItem[]): Promise<void> {
  const { currentItemIds, cycledItemIds } = await loadCycleMembership()
  const counted = items.filter((item) => currentItemIds.has(item.id) || !cycledItemIds.has(item.id))
  const stats: WorkItemStats = { total: counted.length, todo: 0, started: 0, done: 0 }
  for (const item of counted) {
    const counter = COUNTED_GROUPS[(await planeProjectService.stateGroup(item.stateId)) ?? ""]
    if (counter) stats[counter]++
  }
  latest = stats
}

export function currentWorkItemStats(): WorkItemStats | undefined {
  return latest
}
