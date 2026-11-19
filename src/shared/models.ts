export const CLAUDE_MODELS = ["haiku", "sonnet", "opus"] as const

export type ClaudeModel = (typeof CLAUDE_MODELS)[number]

export const PLANNING_MODEL: ClaudeModel = "opus"
export const SINGLE_MODEL: ClaudeModel = "opus"
export const PULL_REQUEST_MODEL: ClaudeModel = "sonnet"

export function isClaudeModel(value: string): value is ClaudeModel {
  return (CLAUDE_MODELS as readonly string[]).includes(value)
}

export function sessionModel(agent: string | undefined, model: string): string {
  return agent === "claude-code" ? model : ""
}
