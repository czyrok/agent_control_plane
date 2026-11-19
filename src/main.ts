import { createServer } from "node:http"
import { handleAnswers } from "./http/answers.ts"
import { handleGit } from "./http/git.ts"
import { handleInternal } from "./http/internal.ts"
import { handleMcp } from "./http/mcp.ts"
import { handleSessions } from "./http/sessions.ts"
import { startPlaneSync } from "./services/plane-sync-service.ts"

createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname
  if (path === "/answers/next") return handleAnswers(request, response)
  if (path === "/sessions/current") return handleSessions(request, response)
  if (path.startsWith("/git/")) return handleGit(request, response)
  return handleMcp(request, response)
}).listen(Number(process.env.MCP_PORT ?? 4331), "0.0.0.0")
createServer(handleInternal).listen(Number(process.env.INTERNAL_PORT ?? 4332), "0.0.0.0")
startPlaneSync()
