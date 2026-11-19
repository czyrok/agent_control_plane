# agent_control_plane

Syncs Plane work items with Coder agent workspaces: starts a workspace for
each ready item, writes the link back, keeps it in step with the item's
state, runs an item's children as batch groups, and serves the agent's Plane
and pull request tools and questions to the operator over MCP. It is the only
service holding a Plane API key or the GitHub token.

## Sync

Every 30 s it reads the project's work items and:

- starts a workspace for each item in **Todo** carrying an `Agent` label
  (`Claude Code` or `OpenCode`) whose blockers are all **Merged**, lowest
  number first, while fewer than `MAX_RUNNING_WORKSPACES` workspaces run;
- creates it for the item's first assignee, as the Coder user with the same
  email, else for Coder's admin;
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
  | **Todo** | batch reset to planning, started if stopped, item moved to **In Progress** |
  | **Backlog** | stopped |
  | **Merged**, **Cancelled**, or item deleted | open descendants moved to the same state, workspace deleted |

  A workspace stopped by hand stays stopped until the state changes. A
  deleted item's workspace is gone with its home volume; moving the item
  back to **Todo** starts a new one.

States and labels are found by the `external_id` Plane provisioning stamps
on them (`todo`, `waiting`, `agent/claude_code`, `issue_type/spec`,
`kind/fix`, …), never by name.

## Batch groups

An `Agent` item with a child not in **Finished**, **Needs Review**,
**Merged** or **Cancelled** runs as a sequence of sessions, each a fresh
agent in the same workspace:

1. **planning**: the agent calls `set_batch_groups` (repeatable, it
   replaces the groups) and then `finish_work_item`;
2. **groups**: one session per group, in order; its tickets move to
   **In Progress** when it starts and **Finished** on `finish_work_item`;
3. **pull_requests**: one session opens the pull requests; skipped for
   `Research` and `Spec` items;
4. **done**: the item is **Finished**.

A group lists Plane keys; a key covers its open sub-tickets, and every open
leaf must be covered exactly once. Groups are fixed once the first one
started: moving the item back to **Todo** clears them and plans again. An
item without open children runs one session, as before.

## MCP tools

Workspaces reach
`http://agent-control-plane-mcp.coder.svc.cluster.local/mcp` (port 4331):

- `get_work_item { key? }` returns the item as Markdown: description, parents
  with their comments, the descendant tree, batch groups, blockers and
  comments. With `key`, it returns that child or sub-child instead:
  description, children, blockers and comments; a key outside the item's
  subtree is refused.
- `add_comment { body }` posts Markdown on the item.
- `finish_work_item { summary }` posts the summary and ends the session's
  task: the next batch group or the pull-request session follows, or the
  item moves to **Finished**.
- `set_batch_groups { groups: [{ name, skill, instructions, items }] }`
  saves the batch groups, in the planning session only.
- `create_pull_request { repository, head, base, title, body, draft }` opens
  a pull request from a branch the item owns.
- `list_pull_requests {}`, `get_pull_request { repository, number }`,
  `update_pull_request { repository, number, title, body, base, state }` and
  `comment_pull_request { repository, number, body }` reach only the pull
  requests the item opened; `state: closed` closes one.
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

## Sessions

`GET /sessions/current` on the MCP port, served to workspace pods only,
returns the batch session the workspace should run: the prompt as text, with
`X-Session-Id` (changes when a new session must start) and `X-Session-Phase`,
or `204` for an item without batch groups or a workspace not started from
one. Read from SQLite only.

## GitHub

Workspaces hold no GitHub token. Their git rewrites GitHub's HTTPS and SSH
URLs to `/git/` on the MCP port, which proxies git
smart-HTTP to GitHub with `GITHUB_TOKEN`, for `AGENT_REPOSITORIES` only:

- clone and fetch pass through, from any workspace;
- a push may create a branch nobody owns, which the item then owns, and may
  update, force or delete only branches the item owns; its feature branch is
  always its own; tags and other refs are refused;
- a refused push gets `403` with the reason, before GitHub is contacted.

Owned branches and pull requests stay with the item, deleted or not.

## Internal API

On `http://agent-control-plane.coder.svc.cluster.local` (port 4332), reached
only by the dashboard namespace:

| Request | Answer |
| --- | --- |
| `GET /waiting` | `{items: [{name, url}]}` of unanswered questions |
| `GET /health` | `ok` |

Links, questions, batch groups and owned branches and pull requests live in
SQLite at `DATABASE_PATH`.

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
| `MCP_PORT` | Port serving `/mcp`, `/answers/next`, `/sessions/current` and `/git/`, `4331` |
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
| `GITHUB_TOKEN` | Fine-grained PAT, Contents and Pull requests write on the agent repositories; empty disables `/git/` and the pull request tools |
| `NOTIFICATION_EMAIL` | Address ntfy also emails; empty sends none |
| `NODE_EXTRA_CA_CERTS` | The ServiceAccount `ca.crt`, to trust the API server |

The Terraform module in `.terraform-module/` sets all of them.

## Traps

- The Plane API key is re-minted on every start: the previous key labelled
  `agent-control-plane` is revoked first.
- A workspace falls back to Coder's `admin` when the item has no assignee or
  the assignee has no Coder account with the same email; only the first
  assignee at creation counts.
- Plane allows 60 API requests a minute per instance, shared by the sync and
  the agents' tool calls. A `429` skips the tick; raise
  `API_KEY_RATE_LIMIT` on Plane's API if it happens often.

## License

MIT, see `LICENSE`.
