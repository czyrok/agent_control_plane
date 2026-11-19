import type { IncomingMessage, ServerResponse } from "node:http"
import { Readable } from "node:stream"
import type { ReadableStream } from "node:stream/web"
import { gitTransport } from "../infrastructure/github.ts"
import * as githubOwnershipRepository from "../repositories/github-ownership-repository.ts"
import * as workItemWorkspaceRepository from "../repositories/work-item-workspace-repository.ts"
import {
  allowedRepositories,
  createdBranches,
  parseRefCommands,
  pushRefusal,
} from "../services/git-push-policy-service.ts"
import { readBuffer } from "./body.ts"
import { identifyCaller } from "./caller.ts"

const GIT_PATH = /^\/git\/([^/]+)\/([^/]+?)(?:\.git)?\/(info\/refs|git-upload-pack|git-receive-pack)$/
const FORWARDED_HEADERS = ["content-type", "accept", "content-encoding", "git-protocol", "user-agent"]
const RETURNED_HEADERS = ["content-type", "cache-control"]
const PUSH_LIMIT_BYTES = 512 * 1024 * 1024

function refuse(response: ServerResponse, status: number, reason: string): void {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(`${reason}\n`)
}

function forwardedHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers[name]
    if (typeof value === "string") headers[name] = value
  }
  return headers
}

async function relay(upstream: Response, response: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {}
  for (const name of RETURNED_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) headers[name] = value
  }
  response.writeHead(upstream.status, headers)
  if (!upstream.body) {
    response.end()
    return
  }
  Readable.fromWeb(upstream.body as ReadableStream).pipe(response)
}

export async function handleGit(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost")
  const match = GIT_PATH.exec(url.pathname)
  if (!match) {
    response.writeHead(404).end()
    return
  }
  const [, owner, name, suffix] = match
  const repository = `${owner}/${name}`.toLowerCase()
  if (!allowedRepositories().has(repository)) return refuse(response, 403, `${owner}/${name} is not an agent repository`)

  const workspace = await identifyCaller(request, response, "Git is served to workspaces only")
  if (!workspace) return
  const link = workItemWorkspaceRepository.findByWorkspace(workspace)
  const pushing = suffix === "git-receive-pack" || url.searchParams.get("service") === "git-receive-pack"
  if (pushing && !link) return refuse(response, 403, "This workspace was not started from a work item: it cannot push")

  const path = `/${owner}/${name}.git/${suffix}${url.search}`
  const init: RequestInit = { method: request.method, headers: forwardedHeaders(request) }
  try {
    if (suffix === "git-upload-pack") {
      return await relay(
        await gitTransport(path, { ...init, body: Readable.toWeb(request) as BodyInit, duplex: "half" } as RequestInit),
        response,
      )
    }
    if (suffix === "git-receive-pack" && link) {
      const body = await readBuffer(request, PUSH_LIMIT_BYTES)
      if (!body) return refuse(response, 413, "Push larger than 512 MiB")
      const commands = parseRefCommands(body)
      const refusal = pushRefusal(link, repository, commands)
      if (refusal) return refuse(response, 403, refusal)
      for (const branch of createdBranches(commands)) githubOwnershipRepository.claimBranch(link.itemId, repository, branch)
      return await relay(await gitTransport(path, { ...init, body: body as Uint8Array<ArrayBuffer> }), response)
    }
    return await relay(await gitTransport(path, init), response)
  } catch (error) {
    console.error(`git ${request.method} ${path}:`, error)
    if (!response.headersSent) refuse(response, 502, "GitHub could not be reached")
  }
}
