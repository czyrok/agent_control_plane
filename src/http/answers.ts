import type { IncomingMessage, ServerResponse } from "node:http"
import { acknowledgeAnswer, takePendingAnswer } from "../use-cases/questions.ts"
import { readBody } from "./body.ts"
import { identifyCaller } from "./caller.ts"

export async function handleAnswers(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const workspace = await identifyCaller(request, response, "Answers are served to workspaces only")
  if (!workspace) return
  if (request.method === "GET") {
    const pending = takePendingAnswer(workspace)
    if (!pending) {
      response.writeHead(204).end()
      return
    }
    response
      .writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Answer-Id": pending.id,
        "X-Item-Key": pending.itemKey,
      })
      .end(pending.answer)
    return
  }
  if (request.method === "POST") {
    acknowledgeAnswer(workspace, (await readBody(request)).trim())
    response.writeHead(204).end()
    return
  }
  response.writeHead(405, { Allow: "GET, POST" }).end()
}
