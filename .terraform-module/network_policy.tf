resource "kubernetes_network_policy_v1" "workspaces_to_agent_control_plane" {
  metadata {
    name      = "workspaces-to-agent-control-plane"
    namespace = var.workspaces_namespace_name
  }

  spec {
    pod_selector {}

    policy_types = ["Egress"]

    egress {
      to {
        namespace_selector {
          match_labels = {
            "kubernetes.io/metadata.name" = var.namespace_name
          }
        }

        pod_selector {
          match_labels = {
            app = local.name
          }
        }
      }

      ports {
        port     = tostring(local.mcp_port)
        protocol = "TCP"
      }
    }
  }

  depends_on = [ var.wait_for ]
}

resource "kubernetes_network_policy_v1" "agent_control_plane_ingress" {
  metadata {
    name      = "agent-control-plane-ingress"
    namespace = var.namespace_name
  }

  spec {
    pod_selector {
      match_labels = {
        app = local.name
      }
    }

    policy_types = ["Ingress"]

    ingress {
      from {
        namespace_selector {
          match_labels = {
            "kubernetes.io/metadata.name" = var.workspaces_namespace_name
          }
        }
      }

      ports {
        port     = tostring(local.mcp_port)
        protocol = "TCP"
      }
    }

    dynamic "ingress" {
      for_each = var.dashboard_namespace_name == "" ? [] : [var.dashboard_namespace_name]

      content {
        from {
          namespace_selector {
            match_labels = {
              "kubernetes.io/metadata.name" = ingress.value
            }
          }
        }

        ports {
          port     = tostring(local.internal_port)
          protocol = "TCP"
        }
      }
    }

    dynamic "ingress" {
      for_each = var.health_check_namespace_name == "" ? [] : [var.health_check_namespace_name]

      content {
        from {
          namespace_selector {
            match_labels = {
              "kubernetes.io/metadata.name" = ingress.value
            }
          }
        }

        ports {
          port     = tostring(local.internal_port)
          protocol = "TCP"
        }
      }
    }
  }

  depends_on = [ var.wait_for ]
}

resource "kubernetes_network_policy_v1" "agent_control_plane_to_agent_gatekeeper" {
  count = var.gatekeeper == null ? 0 : 1

  metadata {
    name      = "agent-control-plane-to-agent-gatekeeper"
    namespace = var.gatekeeper.namespace_name
  }

  spec {
    pod_selector {
      match_labels = var.gatekeeper.pod_labels
    }

    policy_types = ["Ingress"]

    ingress {
      from {
        namespace_selector {
          match_labels = {
            "kubernetes.io/metadata.name" = var.namespace_name
          }
        }

        pod_selector {
          match_labels = {
            app = local.name
          }
        }
      }

      ports {
        port     = tostring(var.gatekeeper.port)
        protocol = "TCP"
      }
    }
  }

  depends_on = [ var.wait_for ]
}
