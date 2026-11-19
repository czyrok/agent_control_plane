output "mcp_url" {
  value = "http://${kubernetes_service_v1.agent_control_plane_mcp.metadata[0].name}.${var.namespace_name}.svc.cluster.local/mcp"
}

output "internal_url" {
  value = "http://${kubernetes_service_v1.agent_control_plane_internal.metadata[0].name}.${var.namespace_name}.svc.cluster.local"
}

output "waiting_url" {
  value = "http://${kubernetes_service_v1.agent_control_plane_internal.metadata[0].name}.${var.namespace_name}.svc.cluster.local/waiting"
}

output "stats_url" {
  value = "http://${kubernetes_service_v1.agent_control_plane_internal.metadata[0].name}.${var.namespace_name}.svc.cluster.local/stats"
}

output "health_checks" {
  value = [
    { name = "Agent control plane", url = "http://${kubernetes_service_v1.agent_control_plane_internal.metadata[0].name}.${var.namespace_name}.svc.cluster.local/health", conditions = ["[STATUS] == 200"], headers = {}, public = false },
  ]
}
