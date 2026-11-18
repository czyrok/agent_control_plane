import { marked } from "marked"
import * as planeWorkItemRepository from "../repositories/plane-work-item-repository.ts"
import * as workItemWorkspaceRepository from "../repositories/work-item-workspace-repository.ts"
import * as planeProjectService from "../services/plane-project-service.ts"
import { describeWorkItem } from "../services/work-item-context-service.ts"

async function comment(itemId: string, markdown: string): Promise<void> {
  await planeWorkItemRepository.addComment(itemId, await marked.parse(markdown), crypto.randomUUID())
}

export async function getWorkItemContext(workspace: string): Promise<string | undefined> {
  const link = workItemWorkspaceRepository.findByWorkspace(workspace)
  if (!link) return undefined
  return (await describeWorkItem(link.itemId)) ?? `${link.itemKey} no longer exists in Plane.`
}

export async function addWorkItemComment(workspace: string, markdown: string): Promise<string | undefined> {
  const link = workItemWorkspaceRepository.findByWorkspace(workspace)
  if (!link) return undefined
  await comment(link.itemId, markdown)
  return `Comment added on ${link.itemKey}.`
}

export async function finishWorkItem(workspace: string, summary: string): Promise<string | undefined> {
  const link = workItemWorkspaceRepository.findByWorkspace(workspace)
  if (!link) return undefined
  await comment(link.itemId, `**Summary from the agent**\n\n${summary}`)
  await planeWorkItemRepository.setState(link.itemId, await planeProjectService.stateIdByKey("finished"))
  return `${link.itemKey} moved to Finished.`
}
