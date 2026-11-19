import { env } from "../infrastructure/env.ts"
import { PlaneConflictError, planeRequest } from "../infrastructure/plane.ts"
import type { PlaneComment, PlaneLabel, PlaneMember, PlaneState, WorkItem } from "../shared/types.ts"

export const COMMENT_SOURCE = "agent-control-plane"
const PROVISIONING_SOURCE = "lyre-terraform"

type Page<T> = { results: T[]; next_cursor?: string; next_page_results?: boolean }

type ExternalPayload = { external_source?: string | null; external_id?: string | null }

let projectId: string | undefined
let projectIdentifier: string | undefined

async function paginate<T>(path: string): Promise<T[]> {
  const results: T[] = []
  let cursor: string | undefined
  for (;;) {
    const separator = path.includes("?") ? "&" : "?"
    const page = await planeRequest<Page<T>>(
      "GET",
      `${path}${separator}per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    )
    results.push(...page.results)
    if (!page.next_page_results || !page.next_cursor) return results
    cursor = page.next_cursor
  }
}

function workspacePath(): string {
  return `/api/v1/workspaces/${env("PLANE_WORKSPACE_SLUG")}`
}

export async function findProjectId(): Promise<string> {
  if (projectId) return projectId
  const identifier = env("PLANE_PROJECT_IDENTIFIER")
  const projects = await paginate<{ id: string; identifier: string }>(`${workspacePath()}/projects/`)
  const project = projects.find((candidate) => candidate.identifier === identifier)
  if (!project) throw new Error(`Plane project ${identifier} does not exist`)
  projectId = project.id
  projectIdentifier = project.identifier
  return projectId
}

async function projectPath(): Promise<string> {
  return `${workspacePath()}/projects/${await findProjectId()}`
}

function ownedExternalId(payload: ExternalPayload): string | null {
  return payload.external_source === PROVISIONING_SOURCE ? (payload.external_id ?? null) : null
}

export function htmlToText(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<br\s*\/?>|<\/(p|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim()
}

export async function listWorkItems(): Promise<WorkItem[]> {
  const items = await paginate<{
    id: string
    sequence_id: number
    name: string
    description_html: string | null
    state: string
    parent: string | null
    labels: string[]
    assignees: string[] | null
  }>(`${await projectPath()}/issues/`)
  return items.map((item) => ({
    id: item.id,
    sequenceId: item.sequence_id,
    key: `${projectIdentifier}-${item.sequence_id}`,
    name: item.name,
    description: htmlToText(item.description_html),
    stateId: item.state,
    parentId: item.parent,
    labelIds: item.labels,
    assigneeIds: item.assignees ?? [],
  }))
}

export function descendantsOf(itemId: string, items: WorkItem[]): WorkItem[] {
  const found: WorkItem[] = []
  const visited = new Set([itemId])
  for (let level = [itemId]; level.length > 0; ) {
    const children = items.filter((item) => item.parentId !== null && level.includes(item.parentId) && !visited.has(item.id))
    for (const child of children) visited.add(child.id)
    found.push(...children)
    level = children.map((child) => child.id)
  }
  return found
}

export async function listMembers(): Promise<Map<string, PlaneMember>> {
  const members = await planeRequest<
    { id: string; email: string; first_name?: string; last_name?: string; display_name?: string }[]
  >("GET", `${workspacePath()}/members/`)
  return new Map(
    members.map((member) => [
      member.id,
      {
        email: member.email,
        name: `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim() || member.display_name || member.email,
      },
    ]),
  )
}

export async function listStates(): Promise<PlaneState[]> {
  const states = await paginate<{ id: string; name: string; group: string } & ExternalPayload>(
    `${await projectPath()}/states/`,
  )
  return states.map((state) => ({
    id: state.id,
    name: state.name,
    group: state.group,
    externalId: ownedExternalId(state),
  }))
}

export async function listLabels(): Promise<PlaneLabel[]> {
  const labels = await paginate<{ id: string; name: string; parent: string | null } & ExternalPayload>(
    `${await projectPath()}/labels/`,
  )
  return labels.map((label) => ({
    id: label.id,
    name: label.name,
    parentId: label.parent,
    externalId: ownedExternalId(label),
  }))
}

export async function findBlockerIds(itemId: string): Promise<string[]> {
  const relations = await planeRequest<{ blocked_by?: { issue_id: string }[] }>(
    "GET",
    `${await projectPath()}/work-items/${itemId}/relations/`,
  )
  return (relations.blocked_by ?? []).map((relation) => relation.issue_id)
}

export async function listComments(itemId: string): Promise<PlaneComment[]> {
  const comments = await paginate<{
    id: string
    comment_html: string | null
    external_source: string | null
    created_at: string
  }>(`${await projectPath()}/issues/${itemId}/comments/`)
  return comments
    .map((comment) => ({
      id: comment.id,
      text: htmlToText(comment.comment_html),
      externalSource: comment.external_source,
      createdAt: comment.created_at,
    }))
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
}

export async function addComment(itemId: string, html: string, externalId: string): Promise<string> {
  try {
    const comment = await planeRequest<{ id: string }>("POST", `${await projectPath()}/issues/${itemId}/comments/`, {
      comment_html: html,
      external_source: COMMENT_SOURCE,
      external_id: externalId,
    })
    return comment.id
  } catch (error) {
    if (error instanceof PlaneConflictError) return (error.body as { id: string }).id
    throw error
  }
}

export async function addLink(itemId: string, url: string, title: string): Promise<void> {
  await planeRequest("POST", `${await projectPath()}/issues/${itemId}/links/`, { url, title })
}

export async function setState(itemId: string, stateId: string): Promise<void> {
  await planeRequest("PATCH", `${await projectPath()}/issues/${itemId}/`, { state: stateId })
}
