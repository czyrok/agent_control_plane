import { env } from "./env.ts"

const KEY_LABEL = "agent-control-plane"
const REQUEST_TIMEOUT_MILLISECONDS = 30_000
const DOWNLOAD_TIMEOUT_MILLISECONDS = 120_000

export class PlaneRateLimitedError extends Error {}

export class PlaneConflictError extends Error {
  readonly body: unknown

  constructor(path: string, body: unknown) {
    super(`${path}: 409`)
    this.body = body
  }
}

const cookies = new Map<string, string>()
let apiKey: string | undefined
let signingIn: Promise<void> | undefined

export function planeEnabled(): boolean {
  return Boolean(process.env.PLANE_URL)
}

async function raw(method: string, path: string, init: { body?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { Accept: "application/json", ...init.headers }
  // Plane's cookies are Secure and the in-cluster API is plain HTTP, so a cookie jar would never send them back
  if (cookies.size > 0) headers.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ")
  const response = await fetch(env("PLANE_URL") + path, {
    method,
    body: init.body,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  })
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";")
    const separator = pair.indexOf("=")
    if (separator > 0) cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim())
  }
  return response
}

async function sessionJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await raw(method, path, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
  })
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`)
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

function signIn(): Promise<void> {
  signingIn ??= mintApiKey().finally(() => {
    signingIn = undefined
  })
  return signingIn
}

async function mintApiKey(): Promise<void> {
  cookies.clear()
  apiKey = undefined
  const { csrf_token: csrfToken } = await sessionJson<{ csrf_token: string }>("GET", "/auth/get-csrf-token/")
  const signInResponse = await raw("POST", "/auth/sign-in/", {
    body: new URLSearchParams({
      email: env("PLANE_ADMIN_EMAIL"),
      password: env("PLANE_ADMIN_PASSWORD"),
      csrfmiddlewaretoken: csrfToken,
    }).toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-CSRFToken": csrfToken,
      Referer: `${env("PLANE_URL")}/`,
    },
  })
  const location = signInResponse.headers.get("location") ?? ""
  if (signInResponse.status !== 302 || location.includes("error_code=")) {
    throw new Error(`Plane sign-in refused (${signInResponse.status})`)
  }
  if (!cookies.has("session-id")) throw new Error("Plane sign-in set no session-id cookie")

  const existing = await sessionJson<{ id: string; label: string }[] | { results: { id: string; label: string }[] }>(
    "GET",
    "/api/users/api-tokens/",
  )
  for (const token of Array.isArray(existing) ? existing : existing.results) {
    if (token.label === KEY_LABEL) await sessionJson("DELETE", `/api/users/api-tokens/${token.id}/`)
  }
  const minted = await sessionJson<{ token: string }>("POST", "/api/users/api-tokens/", {
    label: KEY_LABEL,
    description: "agent control plane",
  })
  apiKey = minted.token
}

export async function planeRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!apiKey) await signIn()
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(env("PLANE_URL") + path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Accept: "application/json",
        "X-Api-Key": apiKey ?? "",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    })
    if (response.status === 401 && attempt === 0) {
      await signIn()
      continue
    }
    if (response.status === 429) throw new PlaneRateLimitedError(`${method} ${path}: 429`)
    if (response.status === 409) throw new PlaneConflictError(path, await response.json().catch(() => undefined))
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`)
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }
}

export async function planeDownload(path: string): Promise<Response> {
  if (!apiKey) await signIn()
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(env("PLANE_URL") + path, {
      headers: { "X-Api-Key": apiKey ?? "" },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    })
    if (response.status === 401 && attempt === 0) {
      await signIn()
      continue
    }
    if (response.status === 429) throw new PlaneRateLimitedError(`GET ${path}: 429`)
    const location = response.headers.get("location")
    if (response.status >= 300 && response.status < 400 && location) {
      return fetch(new URL(location, env("PLANE_URL")), { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MILLISECONDS) })
    }
    return response
  }
}
