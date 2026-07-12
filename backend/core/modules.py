"""Rydberg module registry status.

Cross-references the core repo's modules.list (what's installed) against
live Docker containers (what's actually running) so Bridge can report
per-module state without knowing anything about module internals.
"""

from .config import RYDBERG_ROOT
from .docker_client import get_all_containers


def get_rydberg_modules():
    modules_file = RYDBERG_ROOT / "modules.list"
    modules = []
    containers = get_all_containers()
    running_names = {c["name"] for c in containers if c["status"].lower().startswith("up")}

    if modules_file.exists():
        for line in modules_file.read_text().splitlines():
            parts = line.split()
            if not parts:
                continue
            name = parts[0]
            matches = [c for c in containers if c["name"] == name or c["name"].startswith(f"{name}-")]
            detail = "\n".join(f"{m['name']}\t{m['status']}" for m in matches)
            modules.append(
                {
                    "name": name,
                    "running": name in running_names or any(m["status"].lower().startswith("up") for m in matches),
                    "detail": detail,
                }
            )
    return modules