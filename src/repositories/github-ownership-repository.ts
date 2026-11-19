import { database } from "../infrastructure/database.ts"

const statements = {
  insertBranch: database.prepare(
    "INSERT OR IGNORE INTO owned_branches (repository, branch, item_id, created_at) VALUES (?, ?, ?, ?)",
  ),
  selectBranchOwner: database.prepare("SELECT item_id FROM owned_branches WHERE repository = ? AND branch = ?"),
  insertPullRequest: database.prepare(
    "INSERT OR IGNORE INTO owned_pull_requests (repository, number, item_id, created_at) VALUES (?, ?, ?, ?)",
  ),
  selectPullRequestOwner: database.prepare(
    "SELECT item_id FROM owned_pull_requests WHERE repository = ? AND number = ?",
  ),
  selectPullRequests: database.prepare(
    "SELECT repository, number FROM owned_pull_requests WHERE item_id = ? ORDER BY created_at",
  ),
}

export function branchOwner(repository: string, branch: string): string | undefined {
  return (statements.selectBranchOwner.get(repository.toLowerCase(), branch) as { item_id: string } | undefined)?.item_id
}

export function claimBranch(itemId: string, repository: string, branch: string): void {
  statements.insertBranch.run(repository.toLowerCase(), branch, itemId, new Date().toISOString())
}

export function pullRequestOwner(repository: string, number: number): string | undefined {
  return (statements.selectPullRequestOwner.get(repository.toLowerCase(), number) as { item_id: string } | undefined)
    ?.item_id
}

export function claimPullRequest(itemId: string, repository: string, number: number): void {
  statements.insertPullRequest.run(repository.toLowerCase(), number, itemId, new Date().toISOString())
}

export function listPullRequests(itemId: string): { repository: string; number: number }[] {
  return statements.selectPullRequests.all(itemId) as { repository: string; number: number }[]
}
