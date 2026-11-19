import type { IncomingMessage, ServerResponse } from "node:http"
import { listWaiting } from "../use-cases/waiting.ts"
import { currentWorkItemStats } from "../use-cases/work-item-stats.ts"
import { sendJson } from "./body.ts"

export async function handleInternal(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname
  try {
    if (request.method === "GET") {
      if (path === "/waiting") return sendJson(response, 200, { items: await listWaiting() })
      if (path === "/stats") {
        const stats = currentWorkItemStats()
        return stats ? sendJson(response, 200, stats) : sendJson(response, 503, { error: "No Plane sync yet" })
      }
      if (path === "/health") {
        response.writeHead(200, { "Content-Type": "text/plain" }).end("ok")
        return
      }
    }
    response.writeHead(404).end()
  } catch (error) {
    console.error(`${request.method} ${path}:`, error)
    sendJson(response, 500, { error: (error as Error).message })
  }
}
