import { planeEnabled, PlaneRateLimitedError } from "../infrastructure/plane.ts"
import { listWorkItems } from "../repositories/plane-work-item-repository.ts"
import { syncQuestionAnswers } from "../use-cases/questions.ts"
import { startReadyWorkItems } from "../use-cases/start-ready-work-items.ts"
import { syncWorkItemStates } from "../use-cases/sync-work-item-states.ts"

const INTERVAL_MILLISECONDS = 30_000

let running = false

async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    const items = await listWorkItems()
    await syncQuestionAnswers()
    await syncWorkItemStates(items)
    await startReadyWorkItems(items)
  } catch (error) {
    if (!(error instanceof PlaneRateLimitedError)) console.error("plane sync:", error)
  } finally {
    running = false
  }
}

export function startPlaneSync(): void {
  if (!planeEnabled()) return
  void tick()
  setInterval(tick, INTERVAL_MILLISECONDS).unref()
}
