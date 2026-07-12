"""Minimal read-only Docker Engine API client.

Talks directly to /var/run/docker.sock via raw HTTP instead of pulling in
the full `docker` SDK, since Bridge only ever needs GET /containers/json.

Named docker_client.py rather than docker.py on purpose: a local module
called docker.py would shadow the real `docker` PyPI package the moment
it's installed (e.g. if a later feature wants the SDK), and the import
error that produces is a nasty one to debug.
"""

import http.client
import json
import socket
from pathlib import Path

from .config import DOCKER_SOCKET


class _UnixHTTPConnection(http.client.HTTPConnection):
    """http.client connection that dials a unix socket instead of TCP."""

    def __init__(self, socket_path):
        super().__init__("localhost")
        self.socket_path = socket_path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(self.socket_path)


def docker_api_get(path):
    """GET a path from the Docker Engine API. Returns parsed JSON or None."""
    if not Path(DOCKER_SOCKET).exists():
        return None

    try:
        conn = _UnixHTTPConnection(DOCKER_SOCKET)
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


def get_all_containers():
    """List all containers (running + stopped) with name/image/status/ports."""
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