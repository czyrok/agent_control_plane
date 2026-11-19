import { env } from "../infrastructure/env.ts"
import * as planeWorkItemRepository from "../repositories/plane-work-item-repository.ts"
import type { PlaneLabel, PlaneState, WorkItem } from "../shared/types.ts"

const CATALOG_LIFETIME_MILLISECONDS = 300_000

const AGENTS: Record<string, string> = { "agent/claude_code": "claude-code", "agent/opencode": "opencode" }
const SCOPES: Record<string, Scope> = { "issue_type/research": "research", "issue_type/spec": "spec" }
const BRANCH_PREFIXES: Record<string, string> = {
  "kind/feature": "feat",
  "kind/fix": "fix",
  "kind/hotfix": "hotfix",
  "kind/refactor": "refactor",
  "kind/chore": "chore",
  "kind/docs": "docs",
}
const DEFAULT_BRANCH_PREFIX = "feat"
const REPOSITORY_LABEL_PREFIX = "repository/"
const UNBATCHABLE_STATES = new Set(["finished", "needs_review", "merged", "cancelled"])

export type Scope = "research" | "spec"

type Catalog = { states: PlaneState[]; labelsById: Map<string, PlaneLabel>; loadedAt: number }

let catalog: Catalog | undefined

async function loadCatalog(): Promise<Catalog> {
  if (catalog && Date.now() - catalog.loadedAt < CATALOG_LIFETIME_MILLISECONDS) return catalog
  const [states, labels] = await Promise.all([planeWorkItemRepository.listStates(), planeWorkItemRepository.listLabels()])
  catalog = { states, labelsById: new Map(labels.map((label) => [label.id, label])), loadedAt: Date.now() }
  return catalog
}

async function externalLabelIds(item: WorkItem): Promise<string[]> {
  const { labelsById } = await loadCatalog()
  return item.labelIds.flatMap((id) => labelsById.get(id)?.externalId ?? [])
}

export async function stateIdByKey(key: string): Promise<string> {
  const { states } = await loadCatalog()
  const state = states.find((candidate) => candidate.externalId === key)
  if (!state) throw new Error(`Plane state ${key} is not provisioned`)
  return state.id
}

export async function stateGroup(stateId: string): Promise<string | undefined> {
  const { states } = await loadCatalog()
  return states.find((state) => state.id === stateId)?.group
}

export async function isBatchable(item: WorkItem): Promise<boolean> {
  const { states } = await loadCatalog()
  const externalId = states.find((state) => state.id === item.stateId)?.externalId
  return !UNBATCHABLE_STATES.has(externalId ?? "")
}

export async function stateName(stateId: string): Promise<string | undefined> {
  const { states } = await loadCatalog()
  return states.find((state) => state.id === stateId)?.name
}

export async function agentOf(item: WorkItem): Promise<string | undefined> {
  return (await externalLabelIds(item)).map((externalId) => AGENTS[externalId]).find(Boolean)
}

export async function scopeOf(item: WorkItem): Promise<Scope | undefined> {
  return (await externalLabelIds(item)).map((externalId) => SCOPES[externalId]).find(Boolean)
}

export async function branchPrefixOf(item: WorkItem): Promise<string> {
  return (await externalLabelIds(item)).map((externalId) => BRANCH_PREFIXES[externalId]).find(Boolean) ?? DEFAULT_BRANCH_PREFIX
}

export async function labelNames(item: WorkItem): Promise<string[]> {
  const { labelsById } = await loadCatalog()
  return item.labelIds.flatMap((id) => labelsById.get(id)?.name ?? [])
}

export async function repositoriesOf(item: WorkItem, itemsById: Map<string, WorkItem>): Promise<string[]> {
  const repositories: Record<string, string> = JSON.parse(env("AGENT_REPOSITORIES"))
  const visited = new Set<string>()
  for (let current: WorkItem | undefined = item; current && !visited.has(current.id); ) {
    visited.add(current.id)
    const found = (await externalLabelIds(current))
      .filter((externalId) => externalId.startsWith(REPOSITORY_LABEL_PREFIX))
      .flatMap((externalId) => repositories[externalId.slice(REPOSITORY_LABEL_PREFIX.length)] ?? [])
    if (found.length > 0) return [...new Set(found)]
    current = current.parentId ? itemsById.get(current.parentId) : undefined
  }
  return []
}

export function workItemUrl(itemKey: string): string {
  return `${env("PLANE_PUBLIC_URL")}/${env("PLANE_WORKSPACE_SLUG")}/browse/${itemKey}/`
}
