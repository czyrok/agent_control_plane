import * as batchGroupRepository from "../repositories/batch-group-repository.ts"
import * as planeWorkItemRepository from "../repositories/plane-work-item-repository.ts"
import * as workItemWorkspaceRepository from "../repositories/work-item-workspace-repository.ts"
import { buildGroupPrompt, buildPlanningPrompt, buildPullRequestPrompt } from "../services/agent-prompt-service.ts"
import * as planeProjectService from "../services/plane-project-service.ts"
import type { BatchGroupInput, SessionPhase, WorkItem, WorkItemWorkspace } from "../shared/types.ts"
import { comment } from "./work-item-tools.ts"

async function batchableDescendants(itemId: string, items: WorkItem[]): Promise<WorkItem[]> {
  const found: WorkItem[] = []
  for (const descendant of planeWorkItemRepository.descendantsOf(itemId, items)) {
    if (await planeProjectService.isBatchable(descendant)) found.push(descendant)
  }
  return found
}

async function setStates(itemIds: string[], key: string): Promise<void> {
  const stateId = await planeProjectService.stateIdByKey(key)
  for (const itemId of itemIds) await planeWorkItemRepository.setState(itemId, stateId)
}

export async function setBatchGroups(
  workspace: string,
  groups: BatchGroupInput[],
): Promise<{ text: string; isError: boolean } | undefined> {
  const link = workItemWorkspaceRepository.findByWorkspace(workspace)
  if (!link) return undefined
  if (link.phase !== "planning") {
    return {
      text: "Batch groups are fixed once the first group started; ask the operator to move the ticket back to Todo to re-plan.",
      isError: true,
    }
  }
  const items = await planeWorkItemRepository.listWorkItems()
  const descendants = planeWorkItemRepository.descendantsOf(link.itemId, items)
  const batchable = await batchableDescendants(link.itemId, items)
  const batchableIds = new Set(batchable.map((item) => item.id))
  const keyToItem = new Map(batchable.map((item) => [item.key, item]))
  const descendantKeys = new Set(descendants.map((item) => item.key))

  const problems: string[] = []
  const listed = new Set<string>()
  const coverage = new Map<string, number>()
  const resolved = groups.map((group, index) => {
    if (group.items.length === 0) problems.push(`group ${index + 1} "${group.name}" has no ticket`)
    const memberIds = new Set<string>()
    for (const key of group.items) {
      if (listed.has(key)) problems.push(`${key} is listed twice`)
      listed.add(key)
      const item = keyToItem.get(key)
      if (!item) {
        problems.push(descendantKeys.has(key) ? `${key} is already finished` : `${key} is not under ${link.itemKey}`)
        continue
      }
      const covered = [item, ...planeWorkItemRepository.descendantsOf(item.id, items).filter((d) => batchableIds.has(d.id))]
      for (const member of covered) {
        memberIds.add(member.id)
        coverage.set(member.id, (coverage.get(member.id) ?? 0) + 1)
      }
    }
    return { name: group.name, skill: group.skill, instructions: group.instructions, memberIds: [...memberIds] }
  })
  const leaves = batchable.filter((item) => !batchable.some((other) => other.parentId === item.id))
  for (const leaf of leaves) {
    const count = coverage.get(leaf.id) ?? 0
    if (count === 0) problems.push(`${leaf.key} is not covered by any group`)
    if (count > 1) problems.push(`${leaf.key} is covered ${count} times`)
  }
  if (problems.length > 0) return { text: `Batch groups refused:\n- ${problems.join("\n- ")}`, isError: true }

  batchGroupRepository.replace(link.itemId, resolved)
  const keyOf = new Map(items.map((item) => [item.id, item.key]))
  const rendered = resolved
    .map((group, index) => `${index + 1}. ${group.name}: ${group.memberIds.map((id) => keyOf.get(id) ?? id).join(", ")}`)
    .join("\n")
  return { text: `Batch groups saved for ${link.itemKey}:\n${rendered}`, isError: false }
}

async function startGroup(link: WorkItemWorkspace, item: WorkItem, items: WorkItem[], position: number): Promise<string> {
  const groups = batchGroupRepository.listByItem(link.itemId)
  const group = groups[position]
  await setStates(group.memberIds, "in_progress")
  batchGroupRepository.markStatus(link.itemId, position, "in_progress")
  const keyOf = new Map(items.map((candidate) => [candidate.id, candidate.key]))
  const keys = group.memberIds.map((id) => keyOf.get(id) ?? id)
  workItemWorkspaceRepository.setSession(link.itemId, "groups", position, buildGroupPrompt(item, { ...group, keys }, groups.length))
  return `Session finished. Stop now: batch group ${position + 1} of ${groups.length}, "${group.name}", starts in a new session.`
}

async function finishItem(link: WorkItemWorkspace): Promise<string> {
  await setStates([link.itemId], "finished")
  workItemWorkspaceRepository.markDone(link.itemId)
  return `${link.itemKey} moved to Finished.`
}

async function afterLastGroup(link: WorkItemWorkspace, item: WorkItem): Promise<string> {
  if (await planeProjectService.scopeOf(item)) return finishItem(link)
  workItemWorkspaceRepository.setSession(link.itemId, "pull_requests", null, buildPullRequestPrompt(item))
  return "Session finished. Stop now: the pull-request session starts in a new session."
}

export async function finishSession(workspace: string, summary: string): Promise<string | undefined> {
  const link = workItemWorkspaceRepository.findByWorkspace(workspace)
  if (!link) return undefined
  switch (link.phase) {
    case "single":
      await comment(link.itemId, `**Summary from the agent**\n\n${summary}`)
      await setStates([link.itemId], "finished")
      return `${link.itemKey} moved to Finished.`
    case "pull_requests":
      await comment(link.itemId, `**Summary from the agent**\n\n${summary}`)
      return finishItem(link)
    case "done":
      return "Nothing left to finish: the work item is already Finished."
  }
  const items = await planeWorkItemRepository.listWorkItems()
  const item = items.find((candidate) => candidate.id === link.itemId)
  if (!item) return `${link.itemKey} no longer exists in Plane.`
  const groups = batchGroupRepository.listByItem(link.itemId)
  if (link.phase === "planning") {
    if (groups.length === 0) return "No batch group is set: call set_batch_groups first."
    await comment(link.itemId, `**Plan from the agent**\n\n${summary}`)
    return startGroup(link, item, items, 0)
  }
  const position = link.currentGroup ?? 0
  await comment(link.itemId, `**Group ${position + 1} finished**\n\n${summary}`)
  await setStates(groups[position]?.memberIds ?? [], "finished")
  batchGroupRepository.markStatus(link.itemId, position, "finished")
  return position + 1 < groups.length ? startGroup(link, item, items, position + 1) : afterLastGroup(link, item)
}

export async function resetBatch(link: WorkItemWorkspace, items: WorkItem[]): Promise<void> {
  if (link.phase === "single") return
  const item = items.find((candidate) => candidate.id === link.itemId)
  if (!item) return
  batchGroupRepository.clear(link.itemId)
  workItemWorkspaceRepository.setSession(link.itemId, "planning", null, buildPlanningPrompt(item))
}

export function currentSession(
  workspace: string,
): { revision: number; prompt: string; phase: SessionPhase } | undefined {
  const link = workItemWorkspaceRepository.findByWorkspace(workspace)
  if (!link || link.phase === "single") return undefined
  return { revision: link.sessionRevision, prompt: link.sessionPrompt, phase: link.phase }
}
