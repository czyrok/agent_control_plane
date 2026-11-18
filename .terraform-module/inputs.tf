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
  description = "Name of the Service exposing the internal API to the gatekeeper and the dashboard"
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

variable "internal_client_pod_labels" {
  type        = map(string)
  description = "Labels of the pods in namespace_name allowed to call the internal API"
}

variable "dashboard_namespace_name" {
  type        = string
  default     = ""
  description = "Namespace whose pods may read the internal API. Empty admits none"
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
