import { createServer } from "node:http"
import { handleInternal } from "./http/internal.ts"
import { handleMcp } from "./http/mcp.ts"
import { startPlaneSync } from "./services/plane-sync-service.ts"

createServer(handleMcp).listen(Number(process.env.MCP_PORT ?? 4331), "0.0.0.0")
createServer(handleInternal).listen(Number(process.env.INTERNAL_PORT ?? 4332), "0.0.0.0")
startPlaneSync()
