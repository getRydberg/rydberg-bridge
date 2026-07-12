"""Rydberg Bridge — configuration and constants."""

import os
from pathlib import Path

RYDBERG_ROOT = Path(os.environ.get("RYDBERG_ROOT", str(Path.home() / "Rydberg")))
HOST_PROC = os.environ.get("HOST_PROC", "/proc")
DOCKER_SOCKET = "/var/run/docker.sock"