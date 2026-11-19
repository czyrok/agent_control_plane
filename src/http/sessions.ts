import type { IncomingMessage, ServerResponse } from "node:http"
import { currentSession } from "../use-cases/batch-groups.ts"
import { identifyCaller } from "./caller.ts"

export async function handleSessions(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" }).end()
    return
  }
  const workspace = await identifyCaller(request, response, "Sessions are served to workspaces only")
  if (!workspace) return
  const session = currentSession(workspace)
  if (!session) {
    response.writeHead(204).end()
    return
  }
  response
    .writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Session-Id": String(session.revision),
      "X-Session-Phase": session.phase,
    })
    .end(session.prompt)
}
