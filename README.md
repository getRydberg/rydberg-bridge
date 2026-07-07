# Rydberg Bridge

A read-only, mobile-friendly view of everything running on your Rydberg
server: installed modules, all Docker containers, active terminal
sessions (with a read-only screen/tmux content viewer), and system
resources (CPU, RAM, disk, GPU). Named after a ship's bridge — one place
to see everything at a glance, reachable from your phone.

## Why this module is different from every other one

Every other Rydberg module's backend is a normal, self-contained
container. Bridge's backend deliberately isn't, because its entire job
is reporting on things a normal container can't see:

- Other containers (needs the Docker socket)
- Host CPU/RAM/disk (needs the real host view, not a container's own
  limited cgroup view)
- `screen`/`tmux` sessions (these live under your host user's session —
  reachable from a container, but only with matching UID and the right
  socket directory mounted in)

So `backend/`'s container runs with a wider set of host mounts than any
other module — Docker socket, `/proc`, `/sys`, `/dev/dri`, and the tmux
socket directory — all documented in `docker-compose.yml`. This is a
conscious, documented exception per `MODULE_CONTRACT.md`, not an
oversight. The `frontend/` container is completely normal — no special
mounts, same as dashboard's.

## What it is NOT

There's no write/action capability here — you can't restart a container
or kill a session from this page. It's read-only by design. Adding
actions later is possible but deliberately deferred: the moment this
page can *do* things, it needs the same audit-log/approval-queue rigor
as dashboard's agent actions, and that's not built yet.

## Architecture
```
rydberg-bridge/
├── backend/      FastAPI — docker/system/GPU/session queries
├── frontend/     React (Vite + TypeScript)
└── docker-compose.yml
```

## Install as a Rydberg module

```bash
rydberg install bridge https://github.com/getRydberg/rydberg-bridge.git main
rydberg up bridge
```

## Configuration

Before running, verify two host-specific values in `docker-compose.yml`:

- **Your UID** (`id -u`) — must match the backend service's `user:` field,
  or it can't read your tmux/screen sockets (fails silently — empty
  session list, not an error).
- **`video`/`render` group GIDs** (`getent group video render`) — same
  check you'd already done for the inference module; reuse those values.

See `.env.example` for the rest.

## Exposing it publicly — auth is mandatory, not optional

This page can show live terminal content, which may include secrets that
appeared on screen. **Do not expose this without authentication in front
of it.**

Recommended: [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
(free tier) in front of the tunnel hostname you route to this module
(e.g. `bridge.rydberg.app`):

1. Cloudflare Zero Trust → Access → Applications → Add → Self-hosted
2. Application domain: `bridge.rydberg.app`
3. Policy: Allow → your email only

This puts a real login wall in front of the request *before* it reaches
this module at all — the app itself needs no auth logic.

## Known limitation

Disk stats reflect the backend container's own mounted filesystems, not
every host mount, unless you also bind-mount specific host paths (e.g.
`/data`, `/home2`) explicitly in `docker-compose.yml`.

## Status

v1: read-only module list, container list, session list, tmux screen
viewer (screen/GNU-screen capture implemented, picker currently wired
for tmux only), resource view. No historical graphs, no alerting, no
actions — reasonable v2 ideas once this proves useful day to day.