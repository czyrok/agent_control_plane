import type { IncomingMessage, ServerResponse } from "node:http"

export async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}

export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(payload))
}

export async function readBuffer(request: IncomingMessage, limit: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > limit) return undefined
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}
