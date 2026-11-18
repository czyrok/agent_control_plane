import { env } from "./env.ts"

const REQUEST_TIMEOUT_MILLISECONDS = 10_000
const ENDED_BUILD_STATUSES = new Set(["failed", "canceled", "deleted"])

export type CoderWorkspace = { id: string; name: string; ownerName: string }

type WorkspacePayload = {
  id: string
  name: string
  owner_name: string
  latest_build: { transition: string; status: string }
}

let sessionToken: string | undefined

async function login(): Promise<void> {
  const response = await fetch(`${env("CODER_URL")}/api/v2/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: env("CODER_ADMIN_EMAIL"), password: env("CODER_ADMIN_PASSWORD") }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  })
  if (response.status !== 201) throw new Error(`Coder login: ${response.status}`)
  sessionToken = ((await response.json()) as { session_token: string }).session_token
}

async function coderRequest(method: string, path: string, body?: unknown): Promise<Response> {
  if (!sessionToken) await login()
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${env("CODER_URL")}${path}`, {
      method,
      headers: {
        "Coder-Session-Token": sessionToken ?? "",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    })
    if (response.status === 401 && attempt === 0) {
      await login()
      continue
    }
    return response
  }
}

async function coderJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await coderRequest(method, path, body)
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`)
  return (await response.json()) as T
}

function toWorkspace(payload: WorkspacePayload): CoderWorkspace {
  return { id: payload.id, name: payload.name, ownerName: payload.owner_name }
}

export async function findTemplateId(name: string): Promise<string> {
  const templates = await coderJson<{ id: string; name: string }[]>("GET", "/api/v2/templates")
  const template = templates.find((candidate) => candidate.name === name)
  if (!template) throw new Error(`Coder template ${name} does not exist`)
  return template.id
}

export async function createWorkspace(
  name: string,
  templateId: string,
  parameters: Record<string, string>,
): Promise<CoderWorkspace> {
  const response = await coderRequest("POST", "/api/v2/users/me/workspaces", {
    name,
    template_id: templateId,
    rich_parameter_values: Object.entries(parameters).map(([parameter, value]) => ({ name: parameter, value })),
  })
  if (response.status === 409) {
    return toWorkspace(await coderJson<WorkspacePayload>("GET", `/api/v2/users/me/workspace/${name}`))
  }
  if (response.status !== 201) throw new Error(`POST /api/v2/users/me/workspaces: ${response.status}`)
  return toWorkspace((await response.json()) as WorkspacePayload)
}

export async function stopWorkspace(id: string): Promise<void> {
  await coderJson("POST", `/api/v2/workspaces/${id}/builds`, { transition: "stop" })
}

export async function countRunningWorkspaces(): Promise<number> {
  const { workspaces } = await coderJson<{ workspaces: WorkspacePayload[] }>("GET", "/api/v2/workspaces")
  return workspaces.filter(
    ({ latest_build: build }) => build.transition === "start" && !ENDED_BUILD_STATUSES.has(build.status),
  ).length
}
