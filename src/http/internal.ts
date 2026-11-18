import type { IncomingMessage, ServerResponse } from "node:http"
import { listWaiting, postQuestion, readQuestion } from "../use-cases/questions.ts"
import { readBody, sendJson } from "./body.ts"

const QUESTION_PATH = /^\/questions\/([^/]+)$/

async function createQuestion(request: IncomingMessage, response: ServerResponse): Promise<void> {
  let body: { id?: unknown; workspace?: unknown; question?: unknown }
  try {
    body = JSON.parse(await readBody(request))
  } catch {
    sendJson(response, 400, { error: "invalid JSON" })
    return
  }
  const { id, workspace, question } = body ?? {}
  if (typeof id !== "string" || typeof workspace !== "string" || typeof question !== "string" || !question.trim()) {
    sendJson(response, 400, { error: "id, workspace and question are required" })
    return
  }
  const item = await postQuestion(id, workspace, question.trim())
  if (item) sendJson(response, 200, item)
  else sendJson(response, 404, { error: "unlinked" })
}

export async function handleInternal(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname
  try {
    if (request.method === "POST" && path === "/questions") return await createQuestion(request, response)
    if (request.method === "GET") {
      const questionId = QUESTION_PATH.exec(path)?.[1]
      if (questionId) {
        const status = readQuestion(decodeURIComponent(questionId))
        if (status) sendJson(response, 200, status)
        else sendJson(response, 404, { error: "unknown question" })
        return
      }
      if (path === "/waiting") return sendJson(response, 200, { items: listWaiting() })
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
