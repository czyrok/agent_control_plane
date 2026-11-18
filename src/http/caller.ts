import type { IncomingMessage, ServerResponse } from "node:http"
import { env } from "../infrastructure/env.ts"
import { findPodLabelsByIp } from "../infrastructure/kubernetes.ts"
import { sendJson } from "./body.ts"

async function identifyWorkspace(ip: string): Promise<string | undefined> {
  const labels = await findPodLabelsByIp(env("WORKSPACES_NAMESPACE"), ip).catch(() => undefined)
  if (!labels?.["coder.workspace_name"]) return undefined
  return `${labels["coder.workspace_owner"]}/${labels["coder.workspace_name"]}`
}

export async function identifyCaller(
  request: IncomingMessage,
  response: ServerResponse,
  forwardedError: string,
): Promise<string | undefined> {
  if (request.headers["x-forwarded-for"] !== undefined) {
    sendJson(response, 403, { error: forwardedError })
    return undefined
  }
  const ip = (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "")
  const workspace = await identifyWorkspace(ip)
  if (!workspace) {
    console.warn(`mcp: no workspace pod has IP ${ip}`)
    sendJson(response, 403, { error: "Not a workspace", ip })
    return undefined
  }
  return workspace
}
