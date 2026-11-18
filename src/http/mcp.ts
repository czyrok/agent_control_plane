import type { IncomingMessage, ServerResponse } from "node:http"
import { env } from "../infrastructure/env.ts"
import { findPodLabelsByIp } from "../infrastructure/kubernetes.ts"
import { addWorkItemComment, finishWorkItem, getWorkItemContext } from "../use-cases/work-item-tools.ts"
import { readBody, sendJson } from "./body.ts"

type JsonRpcId = string | number | null

type JsonRpcMessage = {
  id?: JsonRpcId
  method?: string
  params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> }
}

const UNLINKED = "This workspace was not started from a Plane work item."

const TOOLS = [
  {
    name: "get_work_item",
    description:
      "Read the Plane work item this workspace was started for: description, parents with their comments, children, blockers and comments. Call it first.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "add_comment",
    description: "Add a Markdown comment on your Plane work item, for anything worth keeping beyond this session.",
    inputSchema: {
      type: "object",
      properties: { body: { type: "string", description: "Markdown" } },
      required: ["body"],
    },
  },
  {
    name: "finish_work_item",
    description: "Post your summary on the Plane work item and move it to Finished. Call it once the work is done.",
    inputSchema: {
      type: "object",
      properties: { summary: { type: "string", description: "Markdown: what was done, links to the pull requests" } },
      required: ["summary"],
    },
  },
]

async function identifyWorkspace(ip: string): Promise<string | undefined> {
  const labels = await findPodLabelsByIp(env("WORKSPACES_NAMESPACE"), ip).catch(() => undefined)
  if (!labels?.["coder.workspace_name"]) return undefined
  return `${labels["coder.workspace_owner"]}/${labels["coder.workspace_name"]}`
}

function text(args: Record<string, unknown>, name: string): string {
  const value = args[name]
  return typeof value === "string" ? value.trim() : ""
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string,
): Promise<{ text: string; isError: boolean }> {
  let result: string | undefined
  switch (name) {
    case "get_work_item":
      result = await getWorkItemContext(workspace)
      break
    case "add_comment": {
      const body = text(args, "body")
      if (!body) return { text: "body is empty", isError: true }
      result = await addWorkItemComment(workspace, body)
      break
    }
    case "finish_work_item": {
      const summary = text(args, "summary")
      if (!summary) return { text: "summary is empty", isError: true }
      result = await finishWorkItem(workspace, summary)
      break
    }
    default:
      return { text: `Unknown tool: ${name}`, isError: true }
  }
  return { text: result ?? UNLINKED, isError: false }
}

async function resultFor(message: JsonRpcMessage, workspace: string): Promise<unknown> {
  switch (message.method) {
    case "initialize":
      return {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "agent-control-plane", version: "1.0.0" },
      }
    case "ping":
      return {}
    case "tools/list":
      return { tools: TOOLS }
    case "tools/call": {
      const { text, isError } = await callTool(message.params?.name ?? "", message.params?.arguments ?? {}, workspace)
      return { content: [{ type: "text", text }], isError }
    }
    default:
      return undefined
  }
}

function reply(
  response: ServerResponse,
  id: JsonRpcId,
  outcome: { result: unknown } | { error: { code: number; message: string } },
): void {
  sendJson(response, 200, { jsonrpc: "2.0", id, ...outcome })
}

export async function handleMcp(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (new URL(request.url ?? "/", "http://localhost").pathname !== "/mcp") {
    response.writeHead(404).end()
    return
  }
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" }).end()
    return
  }
  if (request.headers["x-forwarded-for"] !== undefined) {
    sendJson(response, 403, { error: "MCP is served to workspaces only" })
    return
  }
  const ip = (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "")
  const workspace = await identifyWorkspace(ip)
  if (!workspace) {
    console.warn(`mcp: no workspace pod has IP ${ip}`)
    sendJson(response, 403, { error: "Not a workspace", ip })
    return
  }

  let message: JsonRpcMessage
  try {
    message = JSON.parse(await readBody(request))
  } catch {
    reply(response, null, { error: { code: -32700, message: "Parse error" } })
    return
  }
  if (typeof message !== "object" || message === null) {
    reply(response, null, { error: { code: -32600, message: "Invalid Request" } })
    return
  }
  if (message.id === undefined) {
    response.writeHead(202).end()
    return
  }

  try {
    const result = await resultFor(message, workspace)
    if (result === undefined) reply(response, message.id, { error: { code: -32601, message: "Method not found" } })
    else reply(response, message.id, { result })
  } catch (error) {
    reply(response, message.id, { error: { code: -32603, message: (error as Error).message } })
  }
}
