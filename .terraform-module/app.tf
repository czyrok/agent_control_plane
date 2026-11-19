locals {
  name          = "agent-control-plane"
  mcp_port      = 4331
  internal_port = 4332
  data_path     = "/var/lib/agent_control_plane"
}

resource "kubernetes_service_account_v1" "agent_control_plane" {
  metadata {
    name      = local.name
    namespace = var.namespace_name
  }

  depends_on = [ var.wait_for ]
}

resource "kubernetes_role_v1" "agent_control_plane_workspaces" {
  metadata {
    name      = local.name
    namespace = var.workspaces_namespace_name
  }

  rule {
    api_groups = [""]
    resources  = ["pods"]
    verbs      = ["list"]
  }

  depends_on = [ var.wait_for ]
}

resource "kubernetes_role_binding_v1" "agent_control_plane_workspaces" {
  metadata {
    name      = local.name
    namespace = var.workspaces_namespace_name
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Role"
    name      = kubernetes_role_v1.agent_control_plane_workspaces.metadata[0].name
  }

  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account_v1.agent_control_plane.metadata[0].name
    namespace = var.namespace_name
  }
}

resource "kubernetes_secret_v1" "agent_control_plane" {
  metadata {
    name      = local.name
    namespace = var.namespace_name
  }

  data = {
    plane_admin_password = var.plane_admin_password
    ntfy_token           = var.ntfy_token
    github_token         = var.github_token
  }

  depends_on = [ var.wait_for ]
}

## Bound only once its Deployment schedules: the default local-path class is
## WaitForFirstConsumer, so waiting here would deadlock against that pod
resource "kubernetes_persistent_volume_claim_v1" "agent_control_plane" {
  wait_until_bound = false

  metadata {
    name      = "${local.name}-data"
    namespace = var.namespace_name
  }

  spec {
    access_modes = ["ReadWriteOnce"]

    resources {
      requests = {
        storage = var.storage_size
      }
    }
  }

  depends_on = [ var.wait_for ]
}

resource "kubernetes_deployment_v1" "agent_control_plane" {
  metadata {
    name      = local.name
    namespace = var.namespace_name

    labels = {
      app = local.name
    }

    annotations = {
      "keel.sh/policy"       = "force"
      "keel.sh/trigger"      = "poll"
      "keel.sh/match-tag"    = "true"
      "keel.sh/pollSchedule" = "@every 1m"
    }
  }

  spec {
    replicas = 1

    selector {
      match_labels = {
        app = local.name
      }
    }

    strategy {
      type = "Recreate"
    }

    template {
      metadata {
        labels = {
          app = local.name
        }

        annotations = {
          secret_hash = sha256(jsonencode([var.plane_admin_password, var.ntfy_token, var.github_token]))
        }
      }

      spec {
        service_account_name = kubernetes_service_account_v1.agent_control_plane.metadata[0].name

        security_context {
          run_as_non_root = true
          run_as_user     = 1000
          run_as_group    = 1000
          fs_group        = 1000

          seccomp_profile {
            type = "RuntimeDefault"
          }
        }

        container {
          image             = "${var.local_docker_registry_host}/lyre/agent_control_plane:latest-amd64"
          image_pull_policy = "Always"
          name              = local.name

          port {
            name           = "mcp"
            container_port = local.mcp_port
          }

          port {
            name           = "internal"
            container_port = local.internal_port
          }

          env {
            name  = "MCP_PORT"
            value = tostring(local.mcp_port)
          }

          env {
            name  = "INTERNAL_PORT"
            value = tostring(local.internal_port)
          }

          env {
            name  = "DATABASE_PATH"
            value = "${local.data_path}/control_plane.db"
          }

          env {
            name  = "WORKSPACES_NAMESPACE"
            value = var.workspaces_namespace_name
          }

          env {
            name  = "PLANE_URL"
            value = var.plane.internal_url
          }

          env {
            name  = "PLANE_PUBLIC_URL"
            value = var.plane.public_url
          }

          env {
            name  = "PLANE_WORKSPACE_SLUG"
            value = var.plane.workspace_slug
          }

          env {
            name  = "PLANE_PROJECT_IDENTIFIER"
            value = var.plane.project_identifier
          }

          env {
            name  = "PLANE_ADMIN_EMAIL"
            value = var.plane.admin_email
          }

          env {
            name = "PLANE_ADMIN_PASSWORD"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.agent_control_plane.metadata[0].name
                key  = "plane_admin_password"
              }
            }
          }

          env {
            name  = "CODER_URL"
            value = var.coder.internal_url
          }

          env {
            name  = "CODER_PUBLIC_URL"
            value = var.coder.public_url
          }

          env {
            name  = "CODER_TEMPLATE"
            value = var.coder.template_name
          }

          env {
            name = "CODER_ADMIN_EMAIL"
            value_from {
              secret_key_ref {
                name = var.coder.admin_secret_name
                key  = "email"
              }
            }
          }

          env {
            name = "CODER_ADMIN_PASSWORD"
            value_from {
              secret_key_ref {
                name = var.coder.admin_secret_name
                key  = "password"
              }
            }
          }

          env {
            name  = "AGENT_REPOSITORIES"
            value = jsonencode(var.agent_repositories)
          }

          env {
            name  = "MAX_RUNNING_WORKSPACES"
            value = tostring(var.max_running_workspaces)
          }

          env {
            name  = "NTFY_URL"
            value = var.ntfy_url
          }

          env {
            name  = "NTFY_TOPIC"
            value = var.ntfy_topic
          }

          env {
            name = "NTFY_TOKEN"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.agent_control_plane.metadata[0].name
                key  = "ntfy_token"
              }
            }
          }

          env {
            name = "GITHUB_TOKEN"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.agent_control_plane.metadata[0].name
                key  = "github_token"
              }
            }
          }

          env {
            name  = "NOTIFICATION_EMAIL"
            value = var.notification_email
          }

          dynamic "env" {
            for_each = var.gatekeeper == null ? {} : {
              GATEKEEPER_URL        = var.gatekeeper.internal_url
              GATEKEEPER_PUBLIC_URL = var.gatekeeper.public_url
            }

            content {
              name  = env.key
              value = env.value
            }
          }

          env {
            name  = "NODE_EXTRA_CA_CERTS"
            value = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
          }

          security_context {
            allow_privilege_escalation = false
            read_only_root_filesystem  = true

            capabilities {
              drop = ["ALL"]
            }
          }

          readiness_probe {
            http_get {
              path = "/health"
              port = local.internal_port
            }

            period_seconds = 10
          }

          liveness_probe {
            http_get {
              path = "/health"
              port = local.internal_port
            }

            period_seconds    = 30
            failure_threshold = 3
          }

          volume_mount {
            name       = "data"
            mount_path = local.data_path
          }
        }

        volume {
          name = "data"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim_v1.agent_control_plane.metadata[0].name
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      spec[0].template[0].metadata[0].annotations["keel.sh/update-time"],
    ]
  }

  depends_on = [
    var.wait_for,
    kubernetes_role_binding_v1.agent_control_plane_workspaces
  ]
}

resource "kubernetes_service_v1" "agent_control_plane_mcp" {
  metadata {
    name      = var.mcp_service_name
    namespace = var.namespace_name
  }

  spec {
    selector = {
      app = kubernetes_deployment_v1.agent_control_plane.metadata[0].labels.app
    }

    port {
      port        = 80
      target_port = local.mcp_port
    }

    type = "ClusterIP"
  }
}

resource "kubernetes_service_v1" "agent_control_plane_internal" {
  metadata {
    name      = var.internal_service_name
    namespace = var.namespace_name
  }

  spec {
    selector = {
      app = kubernetes_deployment_v1.agent_control_plane.metadata[0].labels.app
    }

    port {
      port        = 80
      target_port = local.internal_port
    }

    type = "ClusterIP"
  }
}
