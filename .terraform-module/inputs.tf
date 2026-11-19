variable "namespace_name" {
  type        = string
  description = "Namespace where the agent control plane runs; it must hold the Coder admin Secret"
}

variable "local_docker_registry_host" {
  type        = string
  description = "Host of the local Docker registry"
}

variable "workspaces_namespace_name" {
  type        = string
  description = "Namespace of the agent workspaces, whose pods may call the MCP port"
}

variable "mcp_service_name" {
  type        = string
  description = "Name of the Service exposing the MCP endpoint to workspaces"
}

variable "internal_service_name" {
  type        = string
  description = "Name of the Service exposing the internal API to the dashboard"
}

variable "plane" {
  type = object({
    internal_url       = string
    public_url         = string
    workspace_slug     = string
    project_identifier = string
    admin_email        = string
  })
  description = "Plane instance, workspace and project the work items are read from"
}

variable "plane_admin_password" {
  type        = string
  sensitive   = true
  description = "Password of the Plane admin the API key is minted for"
}

variable "coder" {
  type = object({
    internal_url      = string
    public_url        = string
    admin_secret_name = string
    template_name     = string
  })
  description = "Coder instance, Secret holding its admin email and password, and the template workspaces are created from"
}

variable "agent_repositories" {
  type        = map(string)
  description = "Repository label key to owner/name, as offered by the Coder template"
}

variable "max_running_workspaces" {
  type        = number
  default     = 2
  description = "Running workspaces above which no new work item is started"
}

variable "ntfy_url" {
  type        = string
  default     = ""
  description = "URL of the ntfy server questions are published to; empty sends none"
}

variable "ntfy_topic" {
  type        = string
  default     = ""
  description = "ntfy topic questions are published on"
}

variable "ntfy_token" {
  type        = string
  sensitive   = true
  default     = ""
  description = "ntfy access token allowed to publish on that topic"
}

variable "github_token" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Fine-grained PAT the control plane pushes and opens pull requests with on behalf of workspaces; empty disables both"
}

variable "notification_email" {
  type        = string
  default     = ""
  description = "Address ntfy also emails each question to. Empty sends no email"
}

variable "dashboard_namespace_name" {
  type        = string
  default     = ""
  description = "Namespace whose pods may read the internal API. Empty admits none"
}

variable "health_check_namespace_name" {
  type        = string
  default     = ""
  description = "Namespace whose pods may probe the health endpoint. Empty admits none"
}

variable "gatekeeper" {
  type = object({
    internal_url   = string
    public_url     = string
    namespace_name = string
    pod_labels     = map(string)
    port           = number
  })
  default     = null
  description = "Agent gatekeeper whose pending and stalled egress requests /waiting also lists. Unset lists questions only"
}

variable "storage_size" {
  type        = string
  default     = "256Mi"
  description = "Size of the volume holding the database"
}

variable "wait_for" {
  type        = list(string)
  default     = []
  description = "Identifiers of the steps this module must wait for"
}
