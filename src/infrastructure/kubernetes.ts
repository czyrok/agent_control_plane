import { readFile } from "node:fs/promises"

const API = "https://kubernetes.default.svc"
const REQUEST_TIMEOUT_MILLISECONDS = 10_000
const TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"

async function request(path: string, init: RequestInit = {}) {
  const token = (await readFile(TOKEN_PATH, "utf8")).trim()
  const response = await fetch(`${API}${path}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  })
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status}`)
  return response
}

export async function findPodLabelsByIp(namespace: string, ip: string): Promise<Record<string, string> | undefined> {
  const response = await request(
    `/api/v1/namespaces/${namespace}/pods?fieldSelector=${encodeURIComponent(`status.podIP=${ip},status.phase=Running`)}`,
  )
  const pods: { items: { metadata: { labels?: Record<string, string> } }[] } = await response.json()
  return pods.items[0]?.metadata.labels
}
