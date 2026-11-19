import type { IncomingMessage, ServerResponse } from "node:http"
import { githubEnabled } from "../infrastructure/github.ts"
import type { BatchGroupInput, Question } from "../shared/types.ts"
import { setBatchGroups } from "../use-cases/batch-groups.ts"
import {
  commentPullRequest,
  createPullRequest,
  getPullRequest,
  listOwnPullRequests,
  updatePullRequest,
} from "../use-cases/pull-request-tools.ts"
import { askOperator, awaitAnswer } from "../use-cases/questions.ts"
import { addWorkItemComment, finishWorkItem, getWorkItemContext } from "../use-cases/work-item-tools.ts"
import { readBody, sendJson } from "./body.ts"
import { identifyCaller } from "./caller.ts"

type JsonRpcId = string | number | null

type JsonRpcMessage = {
  id?: JsonRpcId
  method?: string
  params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> }
}

const UNLINKED = "This workspace was not started from a Plane work item."
const ASK_UNLINKED = "This workspace was not started from a Plane work item; ask the user in this session instead."

const WAIT_MILLISECONDS = 25_000

const TOOLS = [
  {
    name: "get_work_item",
    description:
      "Read the Plane work item this workspace was started for: description, parents with their comments, children, blockers and comments. Call it first. Pass key (e.g. LYRE-12) to read one of its children or sub-children in full: description, children, blockers and comments.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key of a child or sub-child; omit for this workspace's own item" },
      },
    },
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
    description:
      "Post your summary and end this session's task: the next batch group, the pull-request session, or moving the item to Needs Review (pull requests opened) or Finished follows. Call it once the session's task is done.",
    inputSchema: {
      type: "object",
      properties: { summary: { type: "string", description: "Markdown: what was done, links to the pull requests" } },
      required: ["summary"],
    },
  },
  {
    name: "set_batch_groups",
    description:
      "Planning session only: save the ordered batch groups the children of your work item run in, one session each. Calling it again replaces them.",
    inputSchema: {
      type: "object",
      required: ["groups"],
      properties: {
        groups: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "items"],
            properties: {
              name: { type: "string" },
              skill: { type: "string" },
              instructions: { type: "string" },
              items: { type: "array", items: { type: "string", description: "Plane key, e.g. LYRE-12" } },
            },
          },
        },
      },
    },
  },
  {
    name: "create_pull_request",
    description: "Open a pull request from a branch this work item created.",
    inputSchema: {
      type: "object",
      required: ["repository", "head", "base", "title"],
      properties: {
        repository: { type: "string", description: "owner/name" },
        head: { type: "string", description: "Branch to merge" },
        base: { type: "string", description: "Branch to merge into" },
        title: { type: "string" },
        body: { type: "string", description: "Markdown" },
        draft: { type: "boolean" },
      },
    },
  },
  {
    name: "list_pull_requests",
    description: "List the pull requests this work item opened, with their state.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_pull_request",
    description: "Read a pull request this work item opened: description, state, reviews and comments.",
    inputSchema: {
      type: "object",
      required: ["repository", "number"],
      properties: { repository: { type: "string", description: "owner/name" }, number: { type: "integer" } },
    },
  },
  {
    name: "update_pull_request",
    description: "Change the title, body, base or state of a pull request this work item opened; state closed closes it.",
    inputSchema: {
      type: "object",
      required: ["repository", "number"],
      properties: {
        repository: { type: "string", description: "owner/name" },
        number: { type: "integer" },
        title: { type: "string" },
        body: { type: "string", description: "Markdown" },
        base: { type: "string" },
        state: { type: "string", enum: ["open", "closed"] },
      },
    },
  },
  {
    name: "comment_pull_request",
    description: "Comment on a pull request this work item opened.",
    inputSchema: {
      type: "object",
      required: ["repository", "number", "body"],
      properties: {
        repository: { type: "string", description: "owner/name" },
        number: { type: "integer" },
        body: { type: "string", description: "Markdown" },
      },
    },
  },
  {
    name: "ask_operator",
    description:
      "Ask the operator what you cannot settle yourself. Posts it on your Plane work item, moves the item to Waiting and notifies them. Waits up to 25 s; if still pending, end your turn: the answer is typed into this session when it arrives.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "Every open question, batched in one Markdown message" } },
      required: ["question"],
    },
  },
  {
    name: "answer_status",
    description: "Wait up to 25 s for the answer to your last ask_operator question.",
    inputSchema: { type: "object", properties: {} },
  },
]

function questionText(question: Question): string {
  if (question.answer === null) {
    return "Pending: the operator has been notified. End your turn now; the answer will arrive as your next message."
  }
  return `Answered: ${question.answer}`
}

function text(args: Record<string, unknown>, name: string): string {
  const value = args[name]
  return typeof value === "string" ? value.trim() : ""
}

function optionalText(args: Record<string, unknown>, name: string): string | undefined {
  return typeof args[name] === "string" ? text(args, name) : undefined
}

function pullRequestNumber(args: Record<string, unknown>): number | undefined {
  const value = args.number
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}

function batchGroups(args: Record<string, unknown>): BatchGroupInput[] | undefined {
  if (!Array.isArray(args.groups)) return undefined
  const groups: BatchGroupInput[] = []
  for (const group of args.groups as unknown[]) {
    if (typeof group !== "object" || group === null) return undefined
    const fields = group as Record<string, unknown>
    const name = text(fields, "name")
    if (!name || !Array.isArray(fields.items) || fields.items.some((item) => typeof item !== "string")) return undefined
    groups.push({
      name,
      skill: text(fields, "skill"),
      instructions: text(fields, "instructions"),
      items: (fields.items as string[]).map((item) => item.trim().toUpperCase()),
    })
  }
  return groups
}

async function callPullRequestTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string,
): Promise<{ text: string; isError: boolean }> {
  if (!githubEnabled()) return { text: "GitHub is not configured on the control plane", isError: true }
  if (name === "list_pull_requests") return { text: (await listOwnPullRequests(workspace)) ?? UNLINKED, isError: false }
  const repository = text(args, "repository")
  if (!repository) return { text: "repository is empty", isError: true }
  let result: string | undefined
  if (name === "create_pull_request") {
    const head = text(args, "head")
    const base = text(args, "base")
    const title = text(args, "title")
    if (!head || !base || !title) return { text: "head, base and title are required", isError: true }
    result = await createPullRequest(workspace, {
      repository,
      head,
      base,
      title,
      body: text(args, "body"),
      draft: args.draft === true,
    })
  } else {
    const number = pullRequestNumber(args)
    if (number === undefined) return { text: "number must be a positive integer", isError: true }
    if (name === "get_pull_request") result = await getPullRequest(workspace, { repository, number })
    if (name === "comment_pull_request") {
      const body = text(args, "body")
      if (!body) return { text: "body is empty", isError: true }
      result = await commentPullRequest(workspace, { repository, number, body })
    }
    if (name === "update_pull_request") {
      const state = optionalText(args, "state")
      if (state !== undefined && state !== "open" && state !== "closed") {
        return { text: "state must be open or closed", isError: true }
      }
      result = await updatePullRequest(workspace, {
        repository,
        number,
        title: optionalText(args, "title"),
        body: optionalText(args, "body"),
        base: optionalText(args, "base"),
        state: state as "open" | "closed" | undefined,
      })
    }
  }
  return { text: result ?? UNLINKED, isError: false }
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string,
): Promise<{ text: string; isError: boolean }> {
  let result: string | undefined
  switch (name) {
    case "get_work_item":
      result = await getWorkItemContext(workspace, optionalText(args, "key"))
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
    case "set_batch_groups": {
      const groups = batchGroups(args)
      if (!groups || groups.length === 0) {
        return { text: "groups must be a non-empty list of { name, skill, instructions, items }", isError: true }
      }
      return (await setBatchGroups(workspace, groups)) ?? { text: UNLINKED, isError: false }
    }
    case "create_pull_request":
    case "list_pull_requests":
    case "get_pull_request":
    case "update_pull_request":
    case "comment_pull_request":
      try {
        return await callPullRequestTool(name, args, workspace)
      } catch (error) {
        return { text: (error as Error).message, isError: true }
      }
    case "ask_operator": {
      const question = text(args, "question")
      if (!question) return { text: "question is empty", isError: true }
      const asked = await askOperator(workspace, question, WAIT_MILLISECONDS)
      return { text: asked ? questionText(asked) : ASK_UNLINKED, isError: false }
    }
    case "answer_status": {
      const latest = await awaitAnswer(workspace, WAIT_MILLISECONDS)
      return {
        text: latest ? questionText(latest) : "Unknown: no question was asked from this workspace.",
        isError: false,
      }
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
  const workspace = await identifyCaller(request, response, "MCP is served to workspaces only")
  if (!workspace) return

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
