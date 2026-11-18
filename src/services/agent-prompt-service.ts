import type { WorkItem } from "../shared/types.ts"
import type { Scope } from "./plane-project-service.ts"

function opening(item: WorkItem): string {
  return `You are working on the Plane work item ${item.key} — ${item.name}.

Call get_work_item first: it returns this item with its parents, children, blockers and comments. Decisions already taken live in the research and spec items and in the parents' comments it returns; follow them. Use ask_operator only for what they do not settle, and batch every question in one call. Keep anything worth keeping on the item with add_comment.`
}

function researchTail(scope: Scope): string {
  const result = scope === "spec" ? "spec" : "findings"
  return `This item is ${scope === "spec" ? "a spec" : "research"}: write no code and open no pull requests. First ask every open question about this item and the other items under its parent in a single ask_operator call. Then write the ${result} on the item with add_comment, and call finish_work_item.`
}

const DEFAULT_TAIL =
  "Follow the branch and pull request rules of this workspace. Once your pull requests are open, call finish_work_item with a summary."

export function buildPrompt(item: WorkItem, scope: Scope | undefined): string {
  return `${opening(item)}\n\n${scope ? researchTail(scope) : DEFAULT_TAIL}`
}
