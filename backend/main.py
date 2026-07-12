"""
Rydberg Bridge backend — read-only system status API.

Unlike dashboard's backend, this one deliberately needs broad host access
(docker socket, host /proc + /sys, tmux/screen sockets, GPU devices) — see
the root README.md for why that's a documented exception, not a mistake.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.docker_client import get_all_containers
from core.modules import get_rydberg_modules
from core.resources import get_resources
from core.sessions import get_sessions, get_screen_capture

app = FastAPI(title="Rydberg Bridge")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # fine here — real access control is Cloudflare Access, not this
    allow_methods=["GET"],
)


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