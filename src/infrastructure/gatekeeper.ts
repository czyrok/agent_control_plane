import { env } from "./env.ts"

export type EgressRequest = { id: string; workspace: string; host: string; status: string }

export async function listEgressRequests(): Promise<EgressRequest[]> {
  if (!process.env.GATEKEEPER_URL) return []
  const response = await fetch(`${env("GATEKEEPER_URL")}/api/requests`, { signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`gatekeeper: ${response.status}`)
  return (await response.json()) as EgressRequest[]
}

export function egressRequestUrl(id: string): string {
  return `${env("GATEKEEPER_PUBLIC_URL")}/?request=${encodeURIComponent(id)}`
}
