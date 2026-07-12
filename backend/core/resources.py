"""Host resource stats: load, memory, disk, CPU-per-core, and GPU (both
Intel xpu-smi and NVIDIA nvidia-smi paths, whichever's present)."""

import json
import shutil
import time
from pathlib import Path

from .config import HOST_PROC
from .utils import run


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

    resources["cpu"] = get_cpu_usage()
    resources["disks"] = get_disk_usage()
    resources["gpus"] = get_nvidia_gpus() + get_intel_gpus()

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


def _list_intel_cards():
    """Discover DRM card selectors via `intel_gpu_top -L`, so each GPU gets
    queried individually instead of only ever seeing the first one.
    Format varies a bit by intel-gpu-tools version — this parses
    defensively and just returns [] if nothing recognizable comes back,
    in which case get_intel_gpus() falls back to a single default query."""
    out = run(["intel_gpu_top", "-L"], timeout=5)
    if out.startswith("ERROR"):
        return []

    cards = []
    for line in out.strip().splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[0].lower().startswith("card"):
            cards.append(parts[1])
    return cards


def _parse_intel_gpu_top_json(raw: str):
    """intel_gpu_top -J streams one JSON object per sample rather than a
    single valid document, so grab the first complete {...} via brace
    matching instead of a plain json.loads. Field names have shifted a
    bit across intel-gpu-tools versions, so every lookup here is
    defensive — a missing key becomes None rather than a crash."""
    if raw.startswith("ERROR") or not raw.strip():
        return None

    depth = 0
    start = None
    for i, ch in enumerate(raw):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                try:
                    return json.loads(raw[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def get_intel_gpus():
    """Structured Intel Arc stats via `intel_gpu_top` (intel-gpu-tools) —
    engine utilization and power only. This tool does not report VRAM
    usage at all, unlike nvidia-smi; if VRAM numbers are ever needed here,
    that's a separate xpu-smi-based path, not an extension of this one."""
    if not shutil.which("intel_gpu_top"):
        return []

    cards = _list_intel_cards() or [None]  # None = let the tool pick a default
    gpus = []
    for idx, card in enumerate(cards):
        cmd = ["timeout", "2", "intel_gpu_top", "-J", "-s", "1000"]
        if card:
            cmd += ["-d", card]
        raw = run(cmd, timeout=5)
        obj = _parse_intel_gpu_top_json(raw)
        if obj is None:
            continue

        engines = obj.get("engines", {}) or {}
        busy_vals = [v.get("busy") for v in engines.values() if isinstance(v, dict) and "busy" in v]
        util = round(sum(busy_vals) / len(busy_vals), 1) if busy_vals else None

        power = obj.get("power", {}) or {}
        power_w = power.get("GPU") if isinstance(power, dict) else None

        gpus.append(
            {
                "slot": f"GPU {idx}",
                "name": "Intel Arc",
                "util": util,
                "power_w": power_w,
                "vram_used_gb": None,
                "vram_total_gb": None,
                "temp_c": None,
            }
        )

    return gpus