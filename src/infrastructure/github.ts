import { env } from "./env.ts"

const REQUEST_TIMEOUT_MILLISECONDS = 30_000

export function githubEnabled(): boolean {
  return Boolean(process.env.GITHUB_TOKEN)
}

export async function githubJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${env("GITHUB_TOKEN")}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  })
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`)
  return (response.status === 204 ? undefined : await response.json()) as T
}

export function gitTransport(path: string, init: RequestInit): Promise<Response> {
  const credentials = Buffer.from(`x-access-token:${env("GITHUB_TOKEN")}`).toString("base64")
  return fetch(`https://github.com${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Basic ${credentials}` },
    redirect: "manual",
  })
}
