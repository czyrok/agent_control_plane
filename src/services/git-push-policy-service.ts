import { env } from "../infrastructure/env.ts"
import * as githubOwnershipRepository from "../repositories/github-ownership-repository.ts"
import type { WorkItemWorkspace } from "../shared/types.ts"

export type RefCommand = { oldId: string; newId: string; ref: string }

const BRANCH_PREFIX = "refs/heads/"

const isZero = (id: string) => /^0+$/.test(id)

export function allowedRepositories(): Set<string> {
  const repositories: Record<string, string> = JSON.parse(env("AGENT_REPOSITORIES"))
  return new Set(Object.values(repositories).map((repository) => repository.toLowerCase()))
}

export function parseRefCommands(body: Buffer): RefCommand[] {
  const commands: RefCommand[] = []
  for (let offset = 0; offset + 4 <= body.length; ) {
    const length = Number.parseInt(body.subarray(offset, offset + 4).toString("ascii"), 16)
    if (!length) break
    const line = body
      .subarray(offset + 4, offset + length)
      .toString("utf8")
      .split("\0")[0]
      .replace(/\n$/, "")
    offset += length
    if (line.startsWith("shallow ")) continue
    const [oldId, newId, ref] = line.split(" ")
    commands.push({ oldId, newId, ref })
  }
  return commands
}

export function ownsBranch(link: WorkItemWorkspace, repository: string, branch: string): boolean {
  return branch === link.branch || githubOwnershipRepository.branchOwner(repository, branch) === link.itemId
}

export function createdBranches(commands: RefCommand[]): string[] {
  return commands
    .filter(({ oldId, newId }) => isZero(oldId) && !isZero(newId))
    .map(({ ref }) => ref.slice(BRANCH_PREFIX.length))
}

export function pushRefusal(link: WorkItemWorkspace, repository: string, commands: RefCommand[]): string | undefined {
  for (const { oldId, newId, ref } of commands) {
    if (!ref?.startsWith(BRANCH_PREFIX)) return `${ref}: only branches may be pushed`
    const branch = ref.slice(BRANCH_PREFIX.length)
    if (isZero(oldId) && !isZero(newId)) {
      const owner = branch === link.branch ? link.itemId : githubOwnershipRepository.branchOwner(repository, branch)
      if (owner && owner !== link.itemId) return `${branch} belongs to another work item`
      continue
    }
    if (!ownsBranch(link, repository, branch)) {
      return `${branch} was not created by ${link.itemKey}: push to or delete only branches it created`
    }
  }
  return undefined
}
