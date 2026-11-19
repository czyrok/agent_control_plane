export const CLAUDE_MODELS = ["haiku", "sonnet", "opus"] as const

export type ClaudeModel = (typeof CLAUDE_MODELS)[number]

export const PLANNING_MODEL: ClaudeModel = "opus"
export const SINGLE_MODEL: ClaudeModel = "opus"
export const PULL_REQUEST_MODEL: ClaudeModel = "sonnet"

const OPENCODE_MODEL_LABEL = "deepseek_v4_1_flash"

export function isClaudeModel(value: string): value is ClaudeModel {
  return (CLAUDE_MODELS as readonly string[]).includes(value)
}

export function sessionModel(agent: string | undefined, model: string): string {
  return agent === "claude-code" ? model : ""
}

export function modelLabelKey(agent: string | undefined, model: string): string | undefined {
  if (agent === "opencode") return `model/${OPENCODE_MODEL_LABEL}`
  return model ? `model/${model}` : undefined
}
