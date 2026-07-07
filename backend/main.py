"""
Rydberg Bridge backend — read-only system status API.

Unlike dashboard's backend, this one deliberately needs broad host access
(docker socket, host /proc + /sys, tmux/screen sockets, GPU devices) — see
the root README.md for why that's a documented exception, not a mistake.
"""

import os
import re
import shutil
import subprocess
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Rydberg Bridge")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # fine here — real access control is Cloudflare Access, not this
    allow_methods=["GET"],
)

RYDBERG_ROOT = Path(os.environ.get("RYDBERG_ROOT", str(Path.home() / "Rydberg")))
HOST_PROC = os.environ.get("HOST_PROC", "/proc")


def run(cmd, timeout=5):
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.stdout
    except Exception as e:
        return f"ERROR: {e}"


def get_rydberg_modules():
    modules_file = RYDBERG_ROOT / "modules.list"
    modules = []
    if modules_file.exists():
        for line in modules_file.read_text().splitlines():
            parts = line.split()
            if not parts:
                continue
            name = parts[0]
            ps_out = run(["docker", "ps", "--filter", f"name={name}", "--format", "{{.Names}}\t{{.Status}}"])
            modules.append({"name": name, "running": bool(ps_out.strip()), "detail": ps_out.strip()})
    return modules


def get_all_containers():
    out = run(["docker", "ps", "-a", "--format", "{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}"])
    containers = []
    for line in out.strip().splitlines():
        parts = line.split("|")
        if len(parts) == 4:
            containers.append({"name": parts[0], "image": parts[1], "status": parts[2], "ports": parts[3]})
    return containers


def get_sessions():
    who_out = run(["who"])
    users = [line.strip() for line in who_out.strip().splitlines() if line.strip()]

    screens = []
    if shutil.which("screen"):
        out = run(["screen", "-ls"])
        screens = [line.strip() for line in out.strip().splitlines()
                   if line.strip() and not line.startswith(("No Sockets", "There"))]

    tmux_sessions = []
    if shutil.which("tmux"):
        out = run(["tmux", "list-sessions"])
        if not out.startswith("ERROR") and "no server running" not in out.lower():
            tmux_sessions = [line.strip() for line in out.strip().splitlines() if line.strip()]

    return {"users": users, "screen_sessions": screens, "tmux_sessions": tmux_sessions}


def get_screen_capture(session_name: str, kind: str = "tmux"):
    if kind == "tmux":
        return run(["tmux", "capture-pane", "-t", session_name, "-p"], timeout=5)
    elif kind == "screen":
        tmp = f"/tmp/rydberg_bridge_capture_{session_name}.txt"
        run(["screen", "-S", session_name, "-X", "hardcopy", tmp])
        try:
            return Path(tmp).read_text()
        except Exception as e:
            return f"ERROR reading capture: {e}"
    return "unknown session kind"


def get_resources():
    resources = {}

    loadavg_path = Path(HOST_PROC) / "loadavg"
    resources["load_avg"] = loadavg_path.read_text().split()[:3] if loadavg_path.exists() else []

    meminfo_path = Path(HOST_PROC) / "meminfo"
    if meminfo_path.exists():
        mem = {}
        for line in meminfo_path.read_text().splitlines():
            parts = line.split(":")
            if len(parts) == 2:
                mem[parts[0].strip()] = parts[1].strip()
        total_kb = int(mem.get("MemTotal", "0 kB").split()[0])
        avail_kb = int(mem.get("MemAvailable", "0 kB").split()[0])
        resources["memory"] = {
            "total_mb": total_kb // 1024,
            "available_mb": avail_kb // 1024,
            "used_mb": (total_kb - avail_kb) // 1024,
        }
    else:
        resources["memory"] = {"raw": run(["free", "-m"]).strip()}

    # NOTE: reflects the container's own mounted filesystems unless you
    # also bind-mount specific host paths (e.g. /data, /home2) — see README.
    resources["disk_raw"] = run(["df", "-h"]).strip()

    if shutil.which("xpu-smi"):
        gpu_out = run(["xpu-smi", "stats", "-d", "0"], timeout=8)
        gpu_out += "\n" + run(["xpu-smi", "stats", "-d", "1"], timeout=8)
        resources["gpu_raw"] = gpu_out.strip()
    else:
        resources["gpu_raw"] = "xpu-smi not found on PATH"

    return resources


@app.get("/api/status")
def status():
    return {
        "modules": get_rydberg_modules(),
        "containers": get_all_containers(),
        "sessions": get_sessions(),
        "resources": get_resources(),
    }


@app.get("/api/capture")
def capture(session: str, kind: str = "tmux"):
    return {"session": session, "kind": kind, "content": get_screen_capture(session, kind)}


@app.get("/health")
def health():
    return {"status": "ok"}
