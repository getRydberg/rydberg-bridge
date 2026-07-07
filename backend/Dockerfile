FROM python:3.12-slim
WORKDIR /app

# tmux/screen clients + docker CLI (talks to the mounted HOST socket,
# doesn't run its own daemon) — this module needs these, unlike dashboard's
RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux screen docker.io procps \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
