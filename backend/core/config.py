"""Rydberg Bridge — configuration and constants."""

import os
from pathlib import Path

RYDBERG_ROOT = Path(os.environ.get("RYDBERG_ROOT", str(Path.home() / "Rydberg")))
HOST_PROC = os.environ.get("HOST_PROC", "/proc")
DOCKER_SOCKET = "/var/run/docker.sock"

# Core infra containers (from compose/, not apps/) — always-on, not
# registered in modules.list, so they need their own exclusion from
# get_unassigned_containers() rather than the module-matching logic.
CORE_INFRA_CONTAINERS = {"rydberg-traefik", "rydberg-cloudflared"}