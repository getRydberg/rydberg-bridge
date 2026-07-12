"""Host session discovery: logged-in users, tmux sessions, screen sessions,
and pane capture for either."""

import shutil
from pathlib import Path

from .utils import run


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