# agent_control_plane

Syncs Plane work items with Coder agent workspaces: starts a workspace for
each ready item, writes the link back, keeps it in step with the item's
state, and serves the agent's Plane tools and questions to the operator over
MCP. It is the only service holding a Plane API key.

## Sync

Every 30 s it reads the project's work items and:

- starts a workspace for each item in **Todo** carrying an `Agent` label
  (`Claude Code` or `OpenCode`) whose blockers are all **Merged**, lowest
  number first, while fewer than `MAX_RUNNING_WORKSPACES` workspaces run;
- names it `lyre-<n>`, on branch `<type>/lyre-<n>-<title slug>`, where
  `<type>` comes from the item's `Kind` label (`Feature` → `feat`, `Fix`,
  `Hotfix`, `Refactor`, `Chore`, `Docs`) and is `feat` without one, with the
  item's `Repository` labels (else its nearest ancestor's) and a prompt built for
  the item's `Issue Type` (`Research` and `Spec` items open no pull requests);
- adds a "Coder workspace" link on the item and moves it to **In Progress**;
- moves an item from **Waiting** back to **In Progress** on the first comment
  not posted by this service after a question;
- acts on a linked item only when its state changed since the last tick:

  | New state | Workspace |
  | --- | --- |
  | **In Progress**, **Waiting**, **Finished**, **Needs Review** | started if stopped |
  | **Todo** | started if stopped, item moved to **In Progress** |
  | **Backlog** | stopped |
  | **Merged**, **Cancelled**, or item deleted | open descendants moved to the same state, workspace deleted |

  A workspace stopped by hand stays stopped until the state changes. A
  deleted item's workspace is gone with its home volume; moving the item
  back to **Todo** starts a new one.

States and labels are found by the `external_id` Plane provisioning stamps
on them (`todo`, `waiting`, `agent/claude_code`, `issue_type/spec`,
`kind/fix`, …), never by name.

## MCP tools

Workspaces reach
`http://agent-control-plane-mcp.coder.svc.cluster.local/mcp` (port 4331):

- `get_work_item {}` returns the item as Markdown: description, parents with
  their comments, children, blockers and comments.
- `add_comment { body }` posts Markdown on the item.
- `finish_work_item { summary }` posts the summary and moves the item to
  **Finished**.
- `ask_operator { question }` comments the question on the item as
  "Question from the agent", moves it to **Waiting**, publishes
  `Question on <key>` to ntfy on `NTFY_TOPIC` (`agent-questions`) with a link
  to the item, and waits up to 25 s for the answer.
- `answer_status {}` waits up to 25 s more on the workspace's last question.

A workspace holds one pending question at a time: asking again while one is
pending waits on it instead. Questions never expire. The operator's first
reply comment is the answer.

The caller is identified as in the gatekeeper: the running pod whose IP is
the TCP peer in `WORKSPACES_NAMESPACE`. A workspace not started from a work
item gets a plain answer saying so; `ask_operator` tells it to ask in its
session instead.

## Answers

The workspace delivers an answer into the agent's session itself, through
`/answers/next` on the MCP port, served to workspace pods only:
`GET` returns the oldest undelivered answer as text, with `X-Answer-Id` and
`X-Item-Key`, or `204`; it serves the same answer until `POST` with that id as
body acknowledges it.

## Internal API

On `http://agent-control-plane.coder.svc.cluster.local` (port 4332), reached
only by the dashboard namespace:

| Request | Answer |
| --- | --- |
| `GET /waiting` | `{items: [{name, url}]}` of unanswered questions |
| `GET /health` | `ok` |

Links and questions live in SQLite at `DATABASE_PATH`.

## Develop

`nix develop` gives `bun` and `node`; Coder agent workspaces load the same
shell, as `.#agent`, on start.

```bash
bun install
bun run start
bun run check
```

`bun run start` runs `node src/main.ts` (Node strips the types, there is no
build). Without `PLANE_URL` the sync loop stays off and only the HTTP servers
run.

## Build and push

A push to `main` runs `.github/workflows/image-to-registry.yaml`, which
pushes `lyre/agent_control_plane:latest-amd64` and `latest-arm64` to the
S3-backed registry. It needs an environment `release` holding
`DOCKER_IMAGE_REGISTRY_BUCKET_REGION`, `DOCKER_IMAGE_REGISTRY_BUCKET_NAME`,
`DOCKER_IMAGE_REGISTRY_BUCKET_ACCESS_KEY_ID` and
`DOCKER_IMAGE_REGISTRY_BUCKET_ACCESS_KEY_SECRET`, the gatekeeper's values.

By hand, from the lyre devShell, with the local registry proxy running:

```bash
cargo make registry-image
kubectl -n coder rollout restart deployment agent-control-plane
```

## Environment

| Variable | Value |
| --- | --- |
| `MCP_PORT` | Port serving only `/mcp` and `/answers/next`, `4331` |
| `INTERNAL_PORT` | Port of the internal API, `4332` |
| `DATABASE_PATH` | SQLite file, on the data volume |
| `WORKSPACES_NAMESPACE` | Namespace of the workspace pods allowed on `/mcp` |
| `PLANE_URL` | In-cluster Plane URL; empty disables the sync |
| `PLANE_PUBLIC_URL` | Plane URL used in links |
| `PLANE_WORKSPACE_SLUG` | Plane workspace, `lyre` |
| `PLANE_PROJECT_IDENTIFIER` | Plane project, `LYRE` |
| `PLANE_ADMIN_EMAIL` | Plane admin the API key is minted for |
| `PLANE_ADMIN_PASSWORD` | Its password |
| `CODER_URL` | In-cluster Coder URL |
| `CODER_PUBLIC_URL` | Coder URL used in the workspace link |
| `CODER_TEMPLATE` | Template workspaces are created from, `agent-task` |
| `CODER_ADMIN_EMAIL` | Coder admin, from Coder's admin Secret |
| `CODER_ADMIN_PASSWORD` | Its password, from the same Secret |
| `AGENT_REPOSITORIES` | JSON map of `Repository` label key to `owner/name` |
| `MAX_RUNNING_WORKSPACES` | Running workspaces above which none starts, `2` |
| `NTFY_URL` | ntfy server questions are published to; empty sends no notification |
| `NTFY_TOPIC` | Its topic, `agent-questions` |
| `NTFY_TOKEN` | ntfy token allowed to publish there |
| `NOTIFICATION_EMAIL` | Address ntfy also emails; empty sends none |
| `NODE_EXTRA_CA_CERTS` | The ServiceAccount `ca.crt`, to trust the API server |

The Terraform module in `.terraform-module/` sets all of them.

## Traps

- The Plane API key is re-minted on every start: the previous key labelled
  `agent-control-plane` is revoked first.
- Workspaces are owned by Coder's `admin`. Signed in to Coder as another user,
  they stay hidden unless that user is an owner.
- Plane allows 60 API requests a minute per instance, shared by the sync and
  the agents' tool calls. A `429` skips the tick; raise
  `API_KEY_RATE_LIMIT` on Plane's API if it happens often.

## License

MIT, see `LICENSE`.
