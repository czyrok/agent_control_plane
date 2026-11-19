import type { IncomingMessage, ServerResponse } from "node:http"
import { Readable } from "node:stream"
import type { ReadableStream } from "node:stream/web"
import { PlaneRateLimitedError } from "../infrastructure/plane.ts"
import { openAttachment } from "../use-cases/attachments.ts"
import { identifyCaller } from "./caller.ts"

const ATTACHMENT_PATH = /^\/attachments\/([^/]+)\/([^/]+)$/

function refuse(response: ServerResponse, status: number, reason: string): void {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(`${reason}\n`)
}

export async function handleAttachments(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" }).end()
    return
  }
  const workspace = await identifyCaller(request, response, "Attachments are served to workspaces only")
  if (!workspace) return
  const match = ATTACHMENT_PATH.exec(new URL(request.url ?? "/", "http://localhost").pathname)
  if (!match) {
    response.writeHead(404).end()
    return
  }
  try {
    const result = await openAttachment(workspace, decodeURIComponent(match[1]), decodeURIComponent(match[2]))
    if ("reason" in result) return refuse(response, result.status, result.reason)
    response.writeHead(200, {
      "Content-Type": result.attachment.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${result.attachment.name.replace(/["\r\n]/g, "")}"`,
    })
    Readable.fromWeb(result.file.body as ReadableStream).pipe(response)
  } catch (error) {
    if (response.headersSent) return
    if (error instanceof PlaneRateLimitedError) return refuse(response, 429, "Plane rate limit, retry in a minute")
    console.error(`attachment ${request.url}:`, error)
    refuse(response, 502, "Plane could not be reached")
  }
}
