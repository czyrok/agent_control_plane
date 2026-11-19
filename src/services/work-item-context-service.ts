import * as batchGroupRepository from "../repositories/batch-group-repository.ts"
import * as planeWorkItemRepository from "../repositories/plane-work-item-repository.ts"
import { COMMENT_SOURCE } from "../repositories/plane-work-item-repository.ts"
import type { SessionPhase, WorkItem } from "../shared/types.ts"
import * as planeProjectService from "./plane-project-service.ts"

async function heading(item: WorkItem, level: string): Promise<string> {
  const state = (await planeProjectService.stateName(item.stateId)) ?? "unknown state"
  const labels = await planeProjectService.labelNames(item)
  return `${level} ${item.key} — ${item.name}\n\nState: ${state}${labels.length > 0 ? ` · Labels: ${labels.join(", ")}` : ""}`
}

async function comments(item: WorkItem): Promise<string> {
  const list = await planeWorkItemRepository.listComments(item.id)
  if (list.length === 0) return "_No comments._"
  return list
    .map((comment) => {
      const author = comment.externalSource === COMMENT_SOURCE ? "Agent" : "Operator"
      return `- ${author}: ${comment.text.replace(/\n/g, "\n  ")}`
    })
    .join("\n")
}

function description(item: WorkItem): string {
  return item.description || "_No description._"
}

function ancestors(item: WorkItem, itemsById: Map<string, WorkItem>): WorkItem[] {
  const found: WorkItem[] = []
  const visited = new Set([item.id])
  for (let parent = item.parentId ? itemsById.get(item.parentId) : undefined; parent && !visited.has(parent.id); ) {
    visited.add(parent.id)
    found.push(parent)
    parent = parent.parentId ? itemsById.get(parent.parentId) : undefined
  }
  return found
}

async function childLines(parentId: string, items: WorkItem[], depth: number, visited: Set<string>): Promise<string[]> {
  const lines: string[] = []
  for (const child of items.filter((candidate) => candidate.parentId === parentId && !visited.has(candidate.id))) {
    visited.add(child.id)
    const state = (await planeProjectService.stateName(child.stateId)) ?? "unknown state"
    lines.push(`${"  ".repeat(depth)}- ${child.key} — ${child.name} (${state})`)
    lines.push(...(await childLines(child.id, items, depth + 1, visited)))
  }
  return lines
}

export async function describeWorkItem(itemId: string, phase?: SessionPhase): Promise<string | undefined> {
  const items = await planeWorkItemRepository.listWorkItems()
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const item = itemsById.get(itemId)
  if (!item) return undefined

  const sections = [await heading(item, "#")]
  if (phase && phase !== "single") sections.push(`Session: ${phase}`)
  sections.push(description(item))

  const parents = ancestors(item, itemsById)
  if (parents.length > 0) {
    sections.push("## Parents")
    for (const parent of parents) {
      sections.push(await heading(parent, "###"), description(parent), `Comments:\n\n${await comments(parent)}`)
    }
  }

  const children = await childLines(item.id, items, 0, new Set([item.id]))
  if (children.length > 0) sections.push("## Children", children.join("\n"))

  const groups = batchGroupRepository.listByItem(item.id)
  if (groups.length > 0) {
    sections.push(
      "## Batch groups",
      groups
        .map(
          (group) =>
            `${group.position + 1}. ${group.name} — ${group.status}${group.skill ? ` — skill ${group.skill}` : ""}\n   ${group.memberIds.map((id) => itemsById.get(id)?.key ?? id).join(", ")}${group.instructions ? `\n   ${group.instructions}` : ""}`,
        )
        .join("\n"),
    )
  }

  const blockers = (await planeWorkItemRepository.findBlockerIds(item.id)).flatMap((id) => itemsById.get(id) ?? [])
  if (blockers.length > 0) {
    sections.push("## Blocked by")
    for (const blocker of blockers) {
      sections.push(await heading(blocker, "###"), description(blocker))
      if (await planeProjectService.scopeOf(blocker)) sections.push(`Comments:\n\n${await comments(blocker)}`)
    }
  }

  sections.push("## Comments", await comments(item))
  return sections.join("\n\n")
}
