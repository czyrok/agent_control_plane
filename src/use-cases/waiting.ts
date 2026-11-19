import { egressRequestUrl, listEgressRequests } from "../infrastructure/gatekeeper.ts"
import * as workItemWorkspaceRepository from "../repositories/work-item-workspace-repository.ts"
import { listWaitingQuestions, type WaitingItem } from "./questions.ts"

const WAITING_EGRESS_STATUSES = new Set(["pending", "stalled"])

async function listWaitingEgressRequests(): Promise<WaitingItem[]> {
  const requests = await listEgressRequests().catch((error) => {
    console.error("gatekeeper:", error)
    return []
  })
  return requests
    .filter((request) => WAITING_EGRESS_STATUSES.has(request.status))
    .reverse()
    .map((request) => {
      const link = workItemWorkspaceRepository.findByWorkspace(request.workspace)
      return {
        name: link ? `${link.itemKey} ${link.itemName}` : request.workspace,
        label: `egress ${request.host}${request.status === "stalled" ? " (stalled)" : ""}`,
        url: egressRequestUrl(request.id),
      }
    })
}

export async function listWaiting(): Promise<WaitingItem[]> {
  return [...(await listWaitingQuestions()), ...(await listWaitingEgressRequests())]
}
