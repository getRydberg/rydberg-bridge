"""Rydberg module registry status.

Cross-references the core repo's modules.list (what's installed) against
live Docker containers (what's actually running) so Bridge can report
per-module state without knowing anything about module internals.
"""

from .config import RYDBERG_ROOT
from .docker_client import get_all_containers


def _matches_module(container_name: str, module_name: str) -> bool:
    """Containers follow rydberg-<role>-<module> (e.g.
    rydberg-frontend-portfolio, rydberg-backend-bridge) — the module name
    can land anywhere in the hyphenated name, so match on tokens rather
    than assuming it's a prefix."""
    return module_name in container_name.split("-")


def _registered_module_names():
    modules_file = RYDBERG_ROOT / "modules.list"
    if not modules_file.exists():
        return []
    names = []
    for line in modules_file.read_text().splitlines():
        parts = line.split()
        if parts:
            names.append(parts[0])
    return names


def get_rydberg_modules():
    modules = []
    containers = get_all_containers()
    running_names = {c["name"] for c in containers if c["status"].lower().startswith("up")}

    for name in _registered_module_names():
        matches = [c for c in containers if _matches_module(c["name"], name)]
        detail = "\n".join(f"{m['name']}\t{m['status']}" for m in matches)
        modules.append(
            {
                "name": name,
                "running": name in running_names or any(m["status"].lower().startswith("up") for m in matches),
                "detail": detail,
            }
        )
    return modules


def get_unassigned_containers():
    """Containers not backing any registered module — core infra
    (traefik, cloudflared) plus anything stray or unexpected. Everything
    module-owned is already shown in the Modules panel, so listing it
    again here is just noise."""
    containers = get_all_containers()
    module_names = _registered_module_names()
    return [c for c in containers if not any(_matches_module(c["name"], name) for name in module_names)]