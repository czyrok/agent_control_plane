import { githubJson } from "../infrastructure/github.ts"
import * as githubOwnershipRepository from "../repositories/github-ownership-repository.ts"
import * as workItemWorkspaceRepository from "../repositories/work-item-workspace-repository.ts"
import { allowedRepositories, ownsBranch } from "../services/git-push-policy-service.ts"
import type { WorkItemWorkspace } from "../shared/types.ts"

type PullRequest = {
  number: number
  title: string
  body: string | null
  state: string
  merged_at: string | null
  html_url: string
  head: { ref: string }
  base: { ref: string }
}

type Review = { user: { login: string } | null; state: string; body: string | null }
type ReviewComment = { user: { login: string } | null; path: string; line: number | null; body: string }
type IssueComment = { user: { login: string } | null; body: string }

function repositoryOf(repository: string): string {
  const normalized = repository.toLowerCase()
  if (!allowedRepositories().has(normalized)) throw new Error(`${repository} is not an agent repository`)
  return normalized
}

function ownedLink(workspace: string, repository: string, number: number): WorkItemWorkspace | undefined {
  const link = workItemWorkspaceRepository.findByWorkspace(workspace)
  if (!link) return undefined
  if (githubOwnershipRepository.pullRequestOwner(repositoryOf(repository), number) !== link.itemId) {
    throw new Error(`${repository}#${number} was not opened by ${link.itemKey}; only its own pull requests are reachable.`)
  }
  return link
}

function author(user: { login: string } | null): string {
  return user?.login ?? "ghost"
}

export async function createPullRequest(
  workspace: string,
  input: { repository: string; head: string; base: string; title: string; body: string; draft: boolean },
): Promise<string | undefined> {
  const link = workItemWorkspaceRepository.findByWorkspace(workspace)
  if (!link) return undefined
  const repository = repositoryOf(input.repository)
  if (!ownsBranch(link, repository, input.head)) {
    throw new Error(`${input.head} was not created by ${link.itemKey}: open pull requests only from its branches`)
  }
  const created = await githubJson<PullRequest>("POST", `/repos/${repository}/pulls`, {
    head: input.head,
    base: input.base,
    title: input.title,
    body: input.body,
    draft: input.draft,
  })
  githubOwnershipRepository.claimPullRequest(link.itemId, repository, created.number)
  return `#${created.number} ${created.html_url}`
}

export async function listOwnPullRequests(workspace: string): Promise<string | undefined> {
  const link = workItemWorkspaceRepository.findByWorkspace(workspace)
  if (!link) return undefined
  const owned = githubOwnershipRepository.listPullRequests(link.itemId)
  if (owned.length === 0) return `${link.itemKey} has opened no pull request.`
  const lines: string[] = []
  for (const { repository, number } of owned) {
    const pull = await githubJson<PullRequest>("GET", `/repos/${repository}/pulls/${number}`)
    lines.push(`- ${repository}#${number} ${pull.title} (${pull.merged_at ? "merged" : pull.state}) ${pull.html_url}`)
  }
  return lines.join("\n")
}

export async function getPullRequest(
  workspace: string,
  input: { repository: string; number: number },
): Promise<string | undefined> {
  if (!ownedLink(workspace, input.repository, input.number)) return undefined
  const path = `/repos/${input.repository.toLowerCase()}`
  const [pull, reviews, reviewComments, comments] = await Promise.all([
    githubJson<PullRequest>("GET", `${path}/pulls/${input.number}`),
    githubJson<Review[]>("GET", `${path}/pulls/${input.number}/reviews`),
    githubJson<ReviewComment[]>("GET", `${path}/pulls/${input.number}/comments`),
    githubJson<IssueComment[]>("GET", `${path}/issues/${input.number}/comments`),
  ])
  const sections = [
    `# ${input.repository}#${pull.number} ${pull.title}`,
    `State: ${pull.merged_at ? "merged" : pull.state} · ${pull.head.ref} → ${pull.base.ref} · ${pull.html_url}`,
    pull.body || "_No description._",
  ]
  if (reviews.length > 0) {
    sections.push(
      "## Reviews",
      reviews.map((review) => `- ${author(review.user)}: ${review.state}${review.body ? ` — ${review.body}` : ""}`).join("\n"),
    )
  }
  if (reviewComments.length > 0) {
    sections.push(
      "## Review comments",
      reviewComments
        .map((comment) => `- ${author(comment.user)} on ${comment.path}${comment.line ? `:${comment.line}` : ""}: ${comment.body}`)
        .join("\n"),
    )
  }
  if (comments.length > 0) {
    sections.push("## Comments", comments.map((comment) => `- ${author(comment.user)}: ${comment.body}`).join("\n"))
  }
  return sections.join("\n\n")
}

export async function updatePullRequest(
  workspace: string,
  input: { repository: string; number: number; title?: string; body?: string; base?: string; state?: "open" | "closed" },
): Promise<string | undefined> {
  if (!ownedLink(workspace, input.repository, input.number)) return undefined
  const { repository, number, ...fields } = input
  const changes = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
  const updated = await githubJson<PullRequest>("PATCH", `/repos/${repository.toLowerCase()}/pulls/${number}`, changes)
  return `${repository}#${number} updated (${updated.state}) ${updated.html_url}`
}

export async function commentPullRequest(
  workspace: string,
  input: { repository: string; number: number; body: string },
): Promise<string | undefined> {
  if (!ownedLink(workspace, input.repository, input.number)) return undefined
  const created = await githubJson<{ html_url: string }>(
    "POST",
    `/repos/${input.repository.toLowerCase()}/issues/${input.number}/comments`,
    { body: input.body },
  )
  return `Comment added: ${created.html_url}`
}
