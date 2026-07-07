"""
Rydberg Bridge backend — read-only system status API.

Unlike dashboard's backend, this one deliberately needs broad host access
(docker socket, host /proc + /sys, tmux/screen sockets, GPU devices) — see
the root README.md for why that's a documented exception, not a mistake.
"""

import os
import shutil
import subprocess
import time
import json
import socket
import http.client
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
DOCKER_SOCKET = "/var/run/docker.sock"


def run(cmd, timeout=5):
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.stdout
    except Exception as e:
        return f"ERROR: {e}"


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
            modules.append({"name": name, "running": name in running_names or any(m["status"].lower().startswith("up") for m in matches), "detail": detail})
    return modules


def get_all_containers():
    data = docker_api_get("/containers/json?all=1")
    if not isinstance(data, list):
        return []

    containers = []
    for item in data:
        names = item.get("Names") or []
        name = names[0].lstrip("/") if names else item.get("Id", "unknown")[:12]
        ports = []
        for p in item.get("Ports") or []:
            private_port = p.get("PrivatePort")
            public_port = p.get("PublicPort")
            typ = p.get("Type", "tcp")
            if public_port:
                ports.append(f"{public_port}->{private_port}/{typ}")
            elif private_port:
                ports.append(f"{private_port}/{typ}")

        containers.append(
            {
                "name": name,
                "image": item.get("Image", ""),
                "status": item.get("Status", ""),
                "ports": ", ".join(ports),
            }
        )

    return containers


def docker_api_get(path):
    if not Path(DOCKER_SOCKET).exists():
        return None

    try:
        class UnixHTTPConnection(http.client.HTTPConnection):
            def __init__(self, socket_path):
                super().__init__("localhost")
                self.socket_path = socket_path

            def connect(self):
                self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                self.sock.connect(self.socket_path)

        conn = UnixHTTPConnection(DOCKER_SOCKET)
        conn.request("GET", path)
        response = conn.getresponse()
        if response.status != 200:
            conn.close()
            return None

        body = response.read()
        conn.close()
        return json.loads(body.decode("utf-8"))
    except Exception:
        return None


def get_sessions():
    who_out = run(["who"])
    users = [line.strip() for line in who_out.strip().splitlines() if line.strip()]

    screens = get_screen_sessions()

    tmux_sessions = []
    if shutil.which("tmux"):
        out = run(["tmux", "list-sessions"])
        if not out.startswith("ERROR") and "no server running" not in out.lower():
            tmux_sessions = [line.strip() for line in out.strip().splitlines() if line.strip()]

    return {"users": users, "screen_sessions": screens, "tmux_sessions": tmux_sessions}


def get_screen_sessions():
    sessions = []
    screen_root = Path("/run/screen")

    if screen_root.exists():
        for user_dir in screen_root.glob("S-*"):
            if not user_dir.is_dir():
                continue
            for sock in user_dir.iterdir():
                if not sock.is_socket():
                    continue
                sessions.append(f"{sock.name} ({user_dir.name})")

    # Fallback for environments where /run/screen is unavailable.
    if not sessions and shutil.which("screen"):
        out = run(["screen", "-ls"])
        sessions = [
            line.strip()
            for line in out.strip().splitlines()
            if line.strip()
            and "can't identify your account" not in line.lower()
            and not line.startswith(("No Sockets", "There"))
        ]

    return sessions


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

    resources["cpu"] = get_cpu_usage()
    resources["disks"] = get_disk_usage()
    resources["gpus"] = get_nvidia_gpus()

    return resources


def _read_cpu_snapshot():
    stat_path = Path(HOST_PROC) / "stat"
    if not stat_path.exists():
        return {}

    snapshot = {}
    for line in stat_path.read_text().splitlines():
        if not line.startswith("cpu"):
            continue
        parts = line.split()
        if len(parts) < 5:
            continue
        key = parts[0]
        values = [int(v) for v in parts[1:]]
        total = sum(values)
        idle = values[3] + (values[4] if len(values) > 4 else 0)
        snapshot[key] = {"total": total, "idle": idle}
    return snapshot


def _usage_pct(prev, curr):
    delta_total = curr["total"] - prev["total"]
    delta_idle = curr["idle"] - prev["idle"]
    if delta_total <= 0:
        return 0.0
    pct = 100.0 * (1.0 - (delta_idle / delta_total))
    return max(0.0, min(100.0, pct))


def get_cpu_usage():
    first = _read_cpu_snapshot()
    if not first:
        return {"avg_percent": 0.0, "per_core": []}

    time.sleep(0.15)
    second = _read_cpu_snapshot()
    if not second:
        return {"avg_percent": 0.0, "per_core": []}

    avg = 0.0
    if "cpu" in first and "cpu" in second:
        avg = round(_usage_pct(first["cpu"], second["cpu"]), 1)

    per_core = []
    core_keys = sorted([k for k in first.keys() if k.startswith("cpu") and k != "cpu"], key=lambda k: int(k[3:]))
    for key in core_keys:
        if key in second:
            per_core.append(round(_usage_pct(first[key], second[key]), 1))

    return {"avg_percent": avg, "per_core": per_core}


def get_disk_usage():
    out = run(["df", "-P", "-k"])
    lines = out.strip().splitlines()
    if not lines:
        return []

    ignored_prefixes = ("tmpfs", "devtmpfs", "overlay", "squashfs", "proc", "sysfs", "cgroup", "nsfs")
    disks = []
    for line in lines[1:]:
        parts = line.split()
        if len(parts) < 6:
            continue

        fs = parts[0]
        if fs.startswith(ignored_prefixes):
            continue

        try:
            total_kb = int(parts[1])
            used_kb = int(parts[2])
            pct = float(parts[4].strip("%"))
        except ValueError:
            continue

        disks.append(
            {
                "mount": parts[5],
                "used_gb": round(used_kb / (1024 * 1024), 1),
                "total_gb": round(total_kb / (1024 * 1024), 1),
                "pct": pct,
            }
        )

    disks.sort(key=lambda d: d["total_gb"], reverse=True)
    return disks[:8]


def get_nvidia_gpus():
    if not shutil.which("nvidia-smi"):
        return []

    out = run(
        [
            "nvidia-smi",
            "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu",
            "--format=csv,noheader,nounits",
        ],
        timeout=8,
    )
    if out.startswith("ERROR"):
        return []

    gpus = []
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 6:
            continue
        try:
            idx = int(parts[0])
            util = float(parts[2])
            mem_used_mb = float(parts[3])
            mem_total_mb = float(parts[4])
            temp_c = float(parts[5])
        except ValueError:
            continue

        gpus.append(
            {
                "slot": f"GPU {idx}",
                "name": parts[1],
                "util": round(util, 1),
                "vram_used_gb": round(mem_used_mb / 1024, 1),
                "vram_total_gb": round(mem_total_mb / 1024, 1),
                "temp_c": round(temp_c, 1),
            }
        )

    return gpus


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
