import * as planeWorkItemRepository from "../repositories/plane-work-item-repository.ts"
import * as workItemWorkspaceRepository from "../repositories/work-item-workspace-repository.ts"
import { ancestors } from "../services/work-item-context-service.ts"
import type { PlaneAttachment } from "../shared/types.ts"

export async function openAttachment(
  workspace: string,
  key: string,
  attachmentId: string,
): Promise<{ status: number; reason: string } | { file: Response; attachment: PlaneAttachment }> {
  const link = workItemWorkspaceRepository.findByWorkspace(workspace)
  if (!link) return { status: 403, reason: "This workspace was not started from a work item" }
  const items = await planeWorkItemRepository.listWorkItems()
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const root = itemsById.get(link.itemId)
  if (!root) return { status: 404, reason: `${link.itemKey} no longer exists in Plane` }
  const readable = [root, ...ancestors(root, itemsById), ...planeWorkItemRepository.descendantsOf(root.id, items)]
  const item = readable.find((candidate) => candidate.key.toUpperCase() === key.toUpperCase())
  if (!item) return { status: 404, reason: `${key} is not ${link.itemKey}, one of its parents or one of its children` }
  const attachment = (await planeWorkItemRepository.listAttachments(item.id)).find(
    (candidate) => candidate.id === attachmentId,
  )
  if (!attachment) return { status: 404, reason: `${key} has no attachment ${attachmentId}` }
  const file = await planeWorkItemRepository.downloadAttachment(item.id, attachmentId)
  if (!file.ok || !file.body) return { status: 502, reason: `Plane answered ${file.status}` }
  return { file, attachment }
}
