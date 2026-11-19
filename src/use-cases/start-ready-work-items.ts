import { countRunningWorkspaces, createWorkspace, findTemplateId, findUserByEmail } from "../infrastructure/coder.ts"
import { env } from "../infrastructure/env.ts"
import { PlaneRateLimitedError } from "../infrastructure/plane.ts"
import * as planeWorkItemRepository from "../repositories/plane-work-item-repository.ts"
import * as workItemWorkspaceRepository from "../repositories/work-item-workspace-repository.ts"
import { buildPrompt } from "../services/agent-prompt-service.ts"
import * as planeProjectService from "../services/plane-project-service.ts"
import type { WorkItem } from "../shared/types.ts"

const BRANCH_MAX_LENGTH = 60

function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

async function blockersDone(item: WorkItem, itemsById: Map<string, WorkItem>): Promise<boolean> {
  for (const blockerId of await planeWorkItemRepository.findBlockerIds(item.id)) {
    const blocker = itemsById.get(blockerId)
    if (!blocker || (await planeProjectService.stateGroup(blocker.stateId)) !== "completed") return false
  }
  return true
}

function hasLiveWorkspace(item: WorkItem): boolean {
  const link = workItemWorkspaceRepository.findByItemId(item.id)
  return link !== undefined && link.deletedAt === null
}

async function ownerOf(item: WorkItem): Promise<string> {
  const [first] = item.assigneeIds
  if (!first) return "me"
  const email = (await planeWorkItemRepository.listMemberEmails()).get(first)
  return (email && (await findUserByEmail(email))) || "me"
}

async function start(item: WorkItem, agent: string, itemsById: Map<string, WorkItem>): Promise<void> {
  const name = item.key.toLowerCase()
  const prefix = await planeProjectService.branchPrefixOf(item)
  const branch = `${prefix}/${name}-${slug(item.name)}`.slice(0, BRANCH_MAX_LENGTH).replace(/-+$/, "")
  const workspace = await createWorkspace(await ownerOf(item), name, await findTemplateId(env("CODER_TEMPLATE")), {
    repositories: JSON.stringify(await planeProjectService.repositoriesOf(item, itemsById)),
    base_branch: "main",
    feature_branch: branch,
    agent,
    feature: buildPrompt(item, await planeProjectService.scopeOf(item)),
  })
  const inProgress = await planeProjectService.stateIdByKey("in_progress")
  workItemWorkspaceRepository.insert({
    itemId: item.id,
    itemKey: item.key,
    itemName: item.name,
    workspace: `${workspace.ownerName}/${workspace.name}`,
    workspaceId: workspace.id,
    createdAt: new Date().toISOString(),
    stoppedAt: null,
    syncedStateId: inProgress,
    deletedAt: null,
  })
  await planeWorkItemRepository.addLink(
    item.id,
    `${env("CODER_PUBLIC_URL")}/@${workspace.ownerName}/${workspace.name}`,
    "Coder workspace",
  )
  await planeWorkItemRepository.setState(item.id, inProgress)
}

export async function startReadyWorkItems(items: WorkItem[]): Promise<void> {
  let free = Number(env("MAX_RUNNING_WORKSPACES")) - (await countRunningWorkspaces())
  if (free <= 0) return

  const todo = await planeProjectService.stateIdByKey("todo")
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const candidates = items
    .filter((item) => item.stateId === todo && !hasLiveWorkspace(item))
    .sort((left, right) => left.sequenceId - right.sequenceId)

  for (const item of candidates) {
    if (free <= 0) return
    try {
      const agent = await planeProjectService.agentOf(item)
      if (!agent || !(await blockersDone(item, itemsById))) continue
      await start(item, agent, itemsById)
      free--
    } catch (error) {
      if (error instanceof PlaneRateLimitedError) throw error
      console.error(`start ${item.key}:`, error)
    }
  }
}
