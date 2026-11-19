import type { BatchGroup, WorkItem } from "../shared/types.ts"
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

export function buildPlanningPrompt(item: WorkItem): string {
  return `${opening(item)}\n\nThis session only plans. Group the children and sub-children of ${item.key} that are not Finished, Needs Review, Merged or Cancelled (never batch those) into ordered batch groups that can each be done in one session, in dependency order. Give each group a short name, the skill to run it with, chosen from the skills under ~/workspace/*/.claude/skills/ (empty if none fits), extra instructions, and the keys of its tickets; listing a ticket covers its open sub-tickets. Call set_batch_groups with all of them (calling it again replaces the batch), write no code, then call finish_work_item with a summary of the plan.`
}

export function buildGroupPrompt(item: WorkItem, group: BatchGroup & { keys: string[] }, total: number): string {
  const skill = group.skill ? `Use the ${group.skill} skill for this work. ` : ""
  return `${opening(item)}\n\nThis session runs batch group ${group.position + 1} of ${total}, "${group.name}", covering ${group.keys.join(", ")}. get_work_item shows every group and its state. ${skill}${group.instructions}\n\nCommit on your branches and push them; open no pull request, a later session does. When this group is done, call finish_work_item with a summary: the next group starts in a new session.`
}

export function buildPullRequestPrompt(item: WorkItem): string {
  return `${opening(item)}\n\nEvery batch group is finished. Make sure every branch is pushed, then open the pull requests, one per repository and branch, against the base branch, each listing the tickets it closes. Then call finish_work_item with their links.`
}
