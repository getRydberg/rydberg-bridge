import { useState, useEffect, useRef } from "react";
import {
  ChevronDown,
  Terminal,
  Users,
  Cpu,
  HardDrive,
  Activity,
  Thermometer,
  Layers,
  Box,
  Database,
} from "lucide-react";

type BridgeModule = { name: string; running: boolean; detail: string };
type BridgeContainer = { name: string; image: string; status: string; ports: string };
type BridgeSessions = { users: string[]; screen_sessions: string[]; tmux_sessions: string[] };
type BridgeMemory = { total_mb: number; available_mb: number; used_mb: number };
type BridgeResources = {
  load_avg: string[];
  memory?: BridgeMemory;
  disk_raw?: string;
  gpu_raw?: string;
  cpu?: { avg_percent: number; per_core: number[] };
  disks?: { mount: string; used_gb: number; total_gb: number; pct: number }[];
  gpus?: {
    slot: string;
    name: string;
    util: number;
    vram_used_gb: number | null;
    vram_total_gb: number | null;
    temp_c: number | null;
  }[];
};
type BridgeStatus = {
  modules: BridgeModule[];
  containers: BridgeContainer[];
  sessions: BridgeSessions;
  resources: BridgeResources;
};

type SessionItem = { name: string; type: "screen" | "tmux" };
type UiModule = { name: string; state: "up" | "down"; profile: string };
type UiContainer = { name: string; image: string; status: string; uptime: string };

// ─── Mock Data ────────────────────────────────────────────────────────────────

const LAST_UPDATED = "14:22:31 UTC";

const MODULES = [
  { name: "synapse", state: "up", profile: "production" },
  { name: "meridian", state: "up", profile: "production" },
  { name: "beacon", state: "down", profile: "staging" },
  { name: "arbiter", state: "up", profile: "production" },
  { name: "relay", state: "up", profile: "production" },
  { name: "chronicle", state: "down", profile: "development" },
];

const CONTAINERS = [
  { name: "nginx-proxy", image: "nginxproxy/nginx-proxy:1.4", status: "running", uptime: "14d 3h" },
  { name: "portainer", image: "portainer/portainer-ce:2.19", status: "running", uptime: "14d 3h" },
  { name: "vaultwarden", image: "vaultwarden/server:1.30", status: "running", uptime: "9d 11h" },
  { name: "plex", image: "plexinc/pms-docker:1.40.4", status: "running", uptime: "2d 7h" },
  { name: "sonarr", image: "linuxserver/sonarr:4.0", status: "running", uptime: "2d 7h" },
  { name: "radarr", image: "linuxserver/radarr:5.2", status: "running", uptime: "2d 7h" },
  { name: "overseerr", image: "sctx/overseerr:1.33", status: "running", uptime: "2d 7h" },
  { name: "homeassistant", image: "homeassistant/home-assistant:2024.1", status: "running", uptime: "5d 2h" },
  { name: "mosquitto", image: "eclipse-mosquitto:2.0", status: "exited", uptime: "—" },
  { name: "influxdb", image: "influxdb:2.7", status: "running", uptime: "9d 11h" },
  { name: "grafana", image: "grafana/grafana:10.2", status: "running", uptime: "9d 11h" },
  { name: "watchtower", image: "containrrr/watchtower:1.7", status: "running", uptime: "14d 3h" },
];

const SESSIONS = [
  { name: "work", type: "screen" },
  { name: "monitor", type: "screen" },
  { name: "build-pipeline", type: "tmux" },
  { name: "logs", type: "tmux" },
  { name: "dev", type: "screen" },
];

const SCREEN_CONTENT: Record<string, string[]> = {
  work: [
    "[work] 0:bash*",
    "",
    "rydberg@homelab ~/projects/synapse",
    "$ python -m uvicorn app.main:app --reload",
    "INFO:     Will watch for changes: ['/home/rydberg/projects/synapse']",
    "INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)",
    "INFO:     Started reloader process [28720] using StatReload",
    "INFO:     Started server process [28722]",
    "INFO:     Waiting for application startup.",
    "INFO:     Application startup complete.",
    "",
    "rydberg@homelab ~/projects/synapse",
    "$",
  ],
  monitor: [
    "[monitor] 0:htop  1:logs*",
    "",
    "rydberg@homelab ~",
    "$ tail -f /var/log/nginx/access.log",
    '192.168.1.42  - [07/Jul/2026:14:22:01 +0000] "GET / HTTP/2.0" 200 4821',
    '192.168.1.42  - [07/Jul/2026:14:22:03 +0000] "GET /api/status HTTP/2.0" 200 312',
    '192.168.1.105 - [07/Jul/2026:14:22:07 +0000] "GET /vault/ HTTP/2.0" 200 1240',
    '192.168.1.42  - [07/Jul/2026:14:22:11 +0000] "GET /api/status HTTP/2.0" 200 312',
    '192.168.1.42  - [07/Jul/2026:14:22:21 +0000] "GET /api/status HTTP/2.0" 200 312',
    '192.168.1.42  - [07/Jul/2026:14:22:31 +0000] "GET /api/status HTTP/2.0" 200 312',
    "",
  ],
  "build-pipeline": [
    "[build-pipeline] 0:main  1:runner*",
    "",
    "rydberg@homelab /srv/builds",
    "$ ./run-pipeline.sh synapse",
    "[14:21:44] Pipeline: synapse @ main",
    "[14:21:44] Step 1/6 — Pulling dependencies...",
    "[14:21:47] Step 2/6 — Running tests...",
    "[14:22:01] ✓ 148 passed, 0 failed",
    "[14:22:01] Step 3/6 — Building Docker image...",
    "[14:22:14] Step 4/6 — Pushing to registry...",
    "[14:22:19] Step 5/6 — Updating compose config...",
    "[14:22:20] Step 6/6 — Done.",
    "[14:22:20] Pipeline complete in 36s",
    "",
    "rydberg@homelab /srv/builds",
    "$",
  ],
  logs: [
    "[logs] 0:bash  1:syslog*",
    "",
    "rydberg@homelab ~",
    "$ journalctl -f -u rydberg",
    "Jul 07 14:21:22 homelab rydberg[1842]: [synapse]   health ok (45ms)",
    "Jul 07 14:21:37 homelab rydberg[1842]: [meridian]  health ok (12ms)",
    "Jul 07 14:21:52 homelab rydberg[1842]: [arbiter]   health ok  (8ms)",
    "Jul 07 14:22:07 homelab rydberg[1842]: [relay]     health ok (23ms)",
    "Jul 07 14:22:22 homelab rydberg[1842]: [synapse]   health ok (41ms)",
    "",
  ],
  dev: [
    "[dev] 0:nvim*  1:bash",
    "",
    "-- meridian/src/router.lua",
    "local M = {}",
    "",
    "function M.dispatch(req)",
    "  local handler = M.routes[req.method .. ' ' .. req.path]",
    "  if not handler then",
    "    return { status = 404, body = 'not found' }",
    "  end",
    "  return handler(req)",
    "end",
    "",
    "M.routes = {}",
    "return M",
    "~",
    "~",
    '"router.lua" 14L, 218B',
  ],
};

const DISKS = [
  { mount: "/", used: 38, total: 120, label: "root" },
  { mount: "/data", used: 2840, total: 4000, label: "data" },
  { mount: "/home", used: 180, total: 500, label: "home" },
  { mount: "/home2", used: 820, total: 2000, label: "home2" },
];

const BASE_CPU_CORES = [34, 12, 67, 45, 23, 89, 56, 31];

const envApiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "";
const pointsToLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(envApiBaseUrl);
const API_BASE_URL = !envApiBaseUrl || pointsToLocalhost ? "/api" : envApiBaseUrl;

function apiUrl(path: string) {
  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${base}${path}`;
}

async function fetchWithTimeout(url: string, timeoutMs = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function parseTmuxName(raw: string) {
  const idx = raw.indexOf(":");
  return (idx > 0 ? raw.slice(0, idx) : raw).trim();
}

function parseScreenName(raw: string) {
  const match = raw.match(/\d+\.([^\s]+)/);
  return (match?.[1] ?? raw).trim();
}

function toSessionItems(sessions: BridgeSessions | undefined): SessionItem[] {
  if (!sessions) {
    return [];
  }

  const mapped: SessionItem[] = [
    ...sessions.screen_sessions.map((line) => ({ name: parseScreenName(line), type: "screen" as const })),
    ...sessions.tmux_sessions.map((line) => ({ name: parseTmuxName(line), type: "tmux" as const })),
  ];

  const deduped = mapped.filter((session, idx) => mapped.findIndex((s) => s.name === session.name) === idx);
  return deduped;
}

function toUiModules(modules: BridgeModule[] | undefined): UiModule[] {
  if (!modules || modules.length === 0) {
    return [];
  }
  return modules.map((mod) => ({
    name: mod.name,
    state: mod.running ? "up" : "down",
    profile: mod.running ? "live" : "inactive",
  }));
}

function toUiContainers(containers: BridgeContainer[] | undefined): UiContainer[] {
  if (!containers || containers.length === 0) {
    return [];
  }
  return containers.map((c) => {
    const status = c.status.toLowerCase().startsWith("up") ? "running" : "exited";
    const uptime = c.status.toLowerCase().startsWith("up") ? c.status.replace(/^Up\s*/i, "") || "up" : "-";
    return { name: c.name, image: c.image, status, uptime };
  });
}

function formatUpdatedAt(date: Date) {
  return `${date.toISOString().slice(11, 19)} UTC`;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function formatGB(gb: number) {
  return gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${gb} GB`;
}

// ─── Atoms ───────────────────────────────────────────────────────────────────

function UpDot() {
  return (
    <span className="relative flex items-center justify-center w-4 h-4 shrink-0" aria-label="online">
      <span
        className="absolute inline-flex w-full h-full rounded-full opacity-30 animate-ping"
        style={{ backgroundColor: "#4d9ef6", animationDuration: "2.4s" }}
      />
      <span
        className="relative inline-block w-2 h-2 rounded-full"
        style={{ backgroundColor: "#4d9ef6", boxShadow: "0 0 6px #4d9ef6aa" }}
      />
    </span>
  );
}

function DownDot() {
  return (
    <span className="relative flex items-center justify-center w-4 h-4 shrink-0" aria-label="offline">
      <span
        className="inline-block w-2.5 h-2.5 rotate-45"
        style={{ backgroundColor: "#f5a623", boxShadow: "0 0 6px #f5a62388" }}
      />
    </span>
  );
}

function StatusPill({ state }: { state: string }) {
  const isUp = state === "up" || state === "running";
  const label = state === "running" ? "RUN" : state === "exited" ? "EXIT" : state.toUpperCase();
  return (
    <span
      className="inline-block text-[9px] font-mono font-semibold tracking-[0.18em] uppercase px-1.5 py-0.5 rounded"
      style={
        isUp
          ? { color: "#4d9ef6", backgroundColor: "#4d9ef614", border: "1px solid #4d9ef628" }
          : { color: "#f5a623", backgroundColor: "#f5a62314", border: "1px solid #f5a62328" }
      }
    >
      {label}
    </span>
  );
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span style={{ color: "#4e6278" }}>{icon}</span>
      <span
        className="text-[10px] font-mono font-medium tracking-[0.22em] uppercase shrink-0"
        style={{ color: "#4e6278" }}
      >
        {label}
      </span>
      <div className="flex-1 h-px" style={{ backgroundColor: "#182030" }} />
    </div>
  );
}

function ResourceBar({
  pct,
  warn = false,
}: {
  pct: number;
  warn?: boolean;
}) {
  const color = warn ? "#f5a623" : pct > 80 ? "#d4b84a" : "#4d9ef6";
  return (
    <div
      className="w-full h-1.5 rounded-full overflow-hidden"
      style={{ backgroundColor: "#111b2e" }}
    >
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }}
      />
    </div>
  );
}

function CoreBars({ values }: { values: number[] }) {
  return (
    <div className="flex items-end gap-px h-7">
      {values.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col justify-end h-full">
          <div
            className="rounded-sm transition-all duration-700"
            style={{
              height: `${Math.max(6, v)}%`,
              backgroundColor: v > 85 ? "#f5a623" : v > 70 ? "#d4b84a" : "#4d9ef6",
              opacity: 0.8,
            }}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Sections ────────────────────────────────────────────────────────────────

function ModulesSection({ modules }: { modules: UiModule[] }) {
  return (
    <section>
      <SectionHeader icon={<Layers size={13} />} label="Rydberg Modules" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {modules.map((mod) => {
          const isUp = mod.state === "up";
          return (
            <div
              key={mod.name}
              className="rounded-lg p-3 flex flex-col gap-2.5"
              style={{
                backgroundColor: "#0c1422",
                border: `1px solid ${isUp ? "#182030" : "#f5a62322"}`,
              }}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono text-sm font-medium truncate" style={{ color: "#d8e4f0" }}>
                  {mod.name}
                </span>
                {isUp ? <UpDot /> : <DownDot />}
              </div>
              <div className="flex items-center justify-between gap-1">
                <StatusPill state={mod.state} />
                <span className="text-[10px] font-mono truncate" style={{ color: "#4e6278" }}>
                  {mod.profile}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ContainersSection({ containers }: { containers: UiContainer[] }) {
  const running = containers.filter((c) => c.status === "running").length;
  const total = containers.length;
  return (
    <section>
      <SectionHeader icon={<Box size={13} />} label={`All Containers · ${running}/${total} running`} />
      <div
        className="rounded-lg overflow-hidden"
        style={{ border: "1px solid #182030" }}
      >
        {containers.map((c, i) => {
          const isUp = c.status === "running";
          return (
            <div
              key={c.name}
              className="flex items-center px-3 py-2.5 gap-3 transition-colors"
              style={{
                backgroundColor: i % 2 === 0 ? "#0c1422" : "#0a1120",
                borderBottom: i < containers.length - 1 ? "1px solid #182030" : undefined,
              }}
            >
              {isUp ? <UpDot /> : <DownDot />}
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm font-medium truncate" style={{ color: "#d8e4f0" }}>
                  {c.name}
                </div>
                <div className="font-mono text-[10px] truncate" style={{ color: "#4e6278" }}>
                  {c.image}
                </div>
              </div>
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <StatusPill state={c.status} />
                <span className="font-mono text-[10px]" style={{ color: "#4e6278" }}>
                  {c.uptime}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SessionsSection({
  sessions,
  selectedSession,
  setSelectedSession,
}: {
  sessions: SessionItem[];
  selectedSession: string;
  setSelectedSession: (s: string) => void;
}) {
  return (
    <section>
      <SectionHeader icon={<Users size={13} />} label="Sessions" />
      <div className="flex flex-col gap-1.5">
        {sessions.map((s) => {
          const active = selectedSession === s.name;
          return (
            <button
              key={s.name}
              onClick={() => setSelectedSession(s.name)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left w-full transition-colors"
              style={{
                backgroundColor: active ? "#4d9ef614" : "#0c1422",
                border: `1px solid ${active ? "#4d9ef640" : "#182030"}`,
              }}
            >
              <Terminal
                size={13}
                style={{ color: active ? "#4d9ef6" : "#4e6278", flexShrink: 0 }}
              />
              <span
                className="font-mono text-sm flex-1"
                style={{ color: active ? "#d8e4f0" : "#7a92aa" }}
              >
                {s.name}
              </span>
              <span
                className="font-mono text-[10px] uppercase tracking-widest"
                style={{ color: "#4e6278" }}
              >
                {s.type}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ScreenViewerSection({
  sessions,
  lines,
  loading,
  error,
  selectedSession,
  setSelectedSession,
}: {
  sessions: SessionItem[];
  lines: string[];
  loading: boolean;
  error: string | null;
  selectedSession: string;
  setSelectedSession: (s: string) => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [selectedSession]);

  return (
    <section>
      <SectionHeader icon={<Terminal size={13} />} label="Screen Viewer" />

      {/* Session picker */}
      <div ref={dropdownRef} className="relative mb-3">
        <button
          onClick={() => setDropdownOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg font-mono text-sm transition-colors"
          style={{
            backgroundColor: "#0c1422",
            border: "1px solid #182030",
            color: "#d8e4f0",
          }}
        >
          <span className="flex items-center gap-2">
            <Terminal size={13} style={{ color: "#4d9ef6" }} />
            {selectedSession}
            <span
              className="text-[10px] uppercase tracking-widest"
              style={{ color: "#4e6278" }}
            >
              · {sessions.find((s) => s.name === selectedSession)?.type}
            </span>
          </span>
          <ChevronDown
            size={14}
            style={{
              color: "#4e6278",
              transform: dropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
          />
        </button>

        {dropdownOpen && (
          <div
            className="absolute top-full left-0 right-0 z-10 rounded-lg mt-1 overflow-hidden"
            style={{
              backgroundColor: "#0c1422",
              border: "1px solid #182030",
              boxShadow: "0 8px 32px #00000066",
            }}
          >
            {sessions.map((s) => (
              <button
                key={s.name}
                onClick={() => {
                  setSelectedSession(s.name);
                  setDropdownOpen(false);
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors font-mono text-sm"
                style={{
                  color: s.name === selectedSession ? "#4d9ef6" : "#7a92aa",
                  backgroundColor: s.name === selectedSession ? "#4d9ef60a" : "transparent",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#111b2e";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                    s.name === selectedSession ? "#4d9ef60a" : "transparent";
                }}
              >
                <Terminal size={12} />
                {s.name}
                <span className="ml-auto text-[10px] uppercase tracking-widest" style={{ color: "#4e6278" }}>
                  {s.type}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Terminal panel */}
      <div
        className="rounded-lg overflow-hidden"
        style={{
          backgroundColor: "#050911",
          border: "1px solid #182030",
          boxShadow: "inset 0 0 40px #00000044",
        }}
      >
        {/* Chrome bar */}
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ borderBottom: "1px solid #182030", backgroundColor: "#080d18" }}
        >
          <span
            className="font-mono text-[10px] uppercase tracking-[0.2em]"
            style={{ color: "#4e6278" }}
          >
            {selectedSession}
          </span>
          <span
            className="ml-auto font-mono text-[10px]"
            style={{ color: "#4e6278" }}
          >
            read-only
          </span>
        </div>

        {/* Terminal content */}
        <div
          ref={terminalRef}
          className="overflow-auto p-4"
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "12px",
            lineHeight: "1.6",
            color: "#8ec8c0",
            maxHeight: "320px",
            scrollbarWidth: "none",
          }}
        >
          {loading && (
            <div style={{ color: "#4e6278", whiteSpace: "pre" }}>Loading capture...</div>
          )}
          {!loading && error && (
            <div style={{ color: "#f5a623", whiteSpace: "pre-wrap" }}>{error}</div>
          )}
          {!loading && !error && lines.map((line, i) => {
            const isStatusLine = i === 0;
            const isPromptLine = line.startsWith("$") || line.endsWith("$");
            const isInfo = line.startsWith("INFO:") || line.startsWith("[14:");
            const isCheck = line.includes("✓");
            const isTilde = line === "~";

            let color = "#8ec8c0";
            if (isStatusLine) color = "#5a7a90";
            else if (isTilde) color = "#2a3e50";
            else if (isInfo) color = "#6ab0c0";
            else if (isCheck) color = "#4d9ef6";
            else if (isPromptLine) color = "#b8d4e0";

            const isLast = i === lines.length - 1;

            return (
              <div key={i} style={{ color, whiteSpace: "pre" }}>
                {line}
                {isLast && isPromptLine && (
                  <span
                    className="inline-block w-[7px] h-[13px] ml-0.5 align-text-bottom"
                    style={{
                      backgroundColor: "#4d9ef6",
                      animation: "termCursor 1.1s step-end infinite",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ResourcesSection({ resources }: { resources: BridgeResources | undefined }) {
  const cpuValues = resources?.cpu?.per_core ?? [];
  const cpuAvg = Math.round(resources?.cpu?.avg_percent ?? 0);

  const ramUsed = ((resources?.memory?.used_mb ?? 0) / 1024);
  const ramTotal = ((resources?.memory?.total_mb ?? 0) / 1024);
  const ramPct = ramTotal > 0 ? (ramUsed / ramTotal) * 100 : 0;

  const disks = resources?.disks ?? [];
  const gpus = resources?.gpus ?? [];

  return (
    <section>
      <SectionHeader icon={<Activity size={13} />} label="Resources" />

      {/* CPU */}
      <div
        className="rounded-lg p-4 mb-3"
        style={{ backgroundColor: "#0c1422", border: "1px solid #182030" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Cpu size={13} style={{ color: "#4e6278" }} />
            <span className="font-mono text-xs uppercase tracking-widest" style={{ color: "#4e6278" }}>
              CPU
            </span>
          </div>
          <span
            className="font-mono text-xl font-semibold tabular-nums"
            style={{ color: cpuAvg > 80 ? "#f5a623" : "#d8e4f0" }}
          >
            {cpuAvg}
            <span className="text-sm font-normal" style={{ color: "#4e6278" }}>%</span>
          </span>
        </div>
        {cpuValues.length > 0 ? (
          <>
            <CoreBars values={cpuValues} />
            <div className="flex justify-between mt-1.5">
              {cpuValues.map((v, i) => (
                <span
                  key={i}
                  className="flex-1 text-center font-mono text-[9px]"
                  style={{ color: "#4e6278" }}
                >
                  {Math.round(v)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="font-mono text-[10px]" style={{ color: "#4e6278" }}>
            CPU core details unavailable.
          </div>
        )}
      </div>

      {/* RAM */}
      <div
        className="rounded-lg p-4 mb-3"
        style={{ backgroundColor: "#0c1422", border: "1px solid #182030" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Database size={13} style={{ color: "#4e6278" }} />
            <span className="font-mono text-xs uppercase tracking-widest" style={{ color: "#4e6278" }}>
              Memory
            </span>
          </div>
          <span className="font-mono text-sm" style={{ color: "#d8e4f0" }}>
            <span className="font-semibold">{ramUsed.toFixed(1)}</span>
            <span style={{ color: "#4e6278" }}> / {ramTotal} GB</span>
          </span>
        </div>
        <ResourceBar pct={ramPct} />
        <div className="flex justify-between mt-1.5">
          <span className="font-mono text-[10px]" style={{ color: "#4e6278" }}>
            {ramUsed.toFixed(1)} GB used
          </span>
          <span className="font-mono text-[10px]" style={{ color: "#4e6278" }}>
            {(ramTotal - ramUsed).toFixed(1)} GB free
          </span>
        </div>
      </div>

      {/* Disk */}
      <div
        className="rounded-lg overflow-hidden mb-3"
        style={{ border: "1px solid #182030" }}
      >
        {disks.map((disk, i) => {
          const pct = disk.pct;
          return (
            <div
              key={disk.mount}
              className="px-4 py-3"
              style={{
                backgroundColor: i % 2 === 0 ? "#0c1422" : "#0a1120",
                borderBottom: i < DISKS.length - 1 ? "1px solid #182030" : undefined,
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <HardDrive size={12} style={{ color: "#4e6278" }} />
                  <span className="font-mono text-xs font-medium" style={{ color: "#d8e4f0" }}>
                    {disk.mount}
                  </span>
                </div>
                <span className="font-mono text-xs" style={{ color: "#4e6278" }}>
                  {formatGB(disk.used_gb)} / {formatGB(disk.total_gb)}
                </span>
              </div>
              <ResourceBar pct={pct} warn={pct > 85} />
            </div>
          );
        })}
        {disks.length === 0 && (
          <div className="px-4 py-3 font-mono text-[10px]" style={{ color: "#4e6278", backgroundColor: "#0c1422" }}>
            Disk details unavailable.
          </div>
        )}
      </div>

      {/* GPUs */}
      <div className="grid grid-cols-2 gap-2">
        {gpus.map((gpu) => {
          const hasVram = gpu.vram_used_gb != null && gpu.vram_total_gb != null;
          const hasTemp = gpu.temp_c != null;
          const vramPct = hasVram ? (gpu.vram_used_gb! / Math.max(gpu.vram_total_gb!, 0.1)) * 100 : 0;

          return (
            <div
              key={gpu.slot}
              className="rounded-lg p-3 flex flex-col gap-3"
              style={{ backgroundColor: "#0c1422", border: "1px solid #182030" }}
            >
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "#4e6278" }}>
                  {gpu.slot}
                </div>
                <div className="font-mono text-xs font-medium" style={{ color: "#7a92aa" }}>
                  {gpu.name}
                </div>
              </div>

              {/* Utilization */}
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "#4e6278" }}>
                    Util
                  </span>
                  <span
                    className="font-mono text-sm font-semibold tabular-nums"
                    style={{ color: gpu.util > 80 ? "#f5a623" : "#d8e4f0" }}
                  >
                    {Math.round(gpu.util)}%
                  </span>
                </div>
                <ResourceBar pct={gpu.util} />
              </div>

              {/* VRAM */}
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "#4e6278" }}>
                    VRAM
                  </span>
                  <span className="font-mono text-xs" style={{ color: "#d8e4f0" }}>
                    {hasVram ? (
                      <>
                        {gpu.vram_used_gb!.toFixed(1)}
                        <span style={{ color: "#4e6278" }}>/{gpu.vram_total_gb!.toFixed(1)}G</span>
                      </>
                    ) : (
                      <span style={{ color: "#4e6278" }}>N/A</span>
                    )}
                  </span>
                </div>
                <ResourceBar pct={vramPct} />
              </div>

              {/* Temp */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Thermometer size={11} style={{ color: "#4e6278" }} />
                  <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "#4e6278" }}>
                    Temp
                  </span>
                </div>
                <span
                  className="font-mono text-sm font-semibold tabular-nums"
                  style={{ color: hasTemp && gpu.temp_c! > 75 ? "#f5a623" : "#d8e4f0" }}
                >
                  {hasTemp ? `${Math.round(gpu.temp_c!)}°C` : "N/A"}
                </span>
              </div>
            </div>
          );
        })}
        {gpus.length === 0 && (
          <div
            className="rounded-lg p-3 flex items-center"
            style={{ backgroundColor: "#0c1422", border: "1px solid #182030", color: "#4e6278" }}
          >
            <span className="font-mono text-[10px]">No GPU telemetry detected.</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [selectedSession, setSelectedSession] = useState("");
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [lastUpdated, setLastUpdated] = useState("waiting for backend");
  const [captureLines, setCaptureLines] = useState<string[]>([]);
  const [captureLoading, setCaptureLoading] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const sessions = toSessionItems(status?.sessions);
  const modules = toUiModules(status?.modules);
  const containers = toUiContainers(status?.containers);

  useEffect(() => {
    let mounted = true;

    const loadStatus = async () => {
      try {
        const response = await fetchWithTimeout(apiUrl("/status"), 5000);
        if (!response.ok) {
          throw new Error(`status request failed (${response.status})`);
        }
        const payload = (await response.json()) as BridgeStatus;
        if (!mounted) {
          return;
        }
        setStatus(payload);
        setLastUpdated(formatUpdatedAt(new Date()));
      } catch {
        if (!mounted) {
          return;
        }
        setLastUpdated("backend unavailable");
        setStatus(null);
      }
    };

    loadStatus();
    const id = setInterval(loadStatus, 10000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!sessions.find((s) => s.name === selectedSession) && sessions.length > 0) {
      setSelectedSession(sessions[0].name);
    }
  }, [selectedSession, sessions]);

  useEffect(() => {
    const session = sessions.find((s) => s.name === selectedSession);
    if (!session) {
      setCaptureLines([]);
      return;
    }

    let mounted = true;
    setCaptureLoading(true);
    setCaptureError(null);

    const params = new URLSearchParams({ session: session.name, kind: session.type });
    fetchWithTimeout(`${apiUrl("/capture")}?${params.toString()}`, 5000)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`capture request failed (${response.status})`);
        }
        const payload = (await response.json()) as { content?: string };
        if (!mounted) {
          return;
        }
        const lines = (payload.content ?? "").split(/\r?\n/);
        setCaptureLines(lines.length > 0 ? lines : ["No capture output."]);
      })
      .catch(() => {
        if (!mounted) {
          return;
        }
        setCaptureError("Capture unavailable for this session.");
      })
      .finally(() => {
        if (mounted) {
          setCaptureLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [selectedSession, sessions]);

  return (
    <div
      className="dark min-h-screen"
      style={{
        backgroundColor: "#070c16",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <style>{`
        @keyframes termCursor {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        ::-webkit-scrollbar { display: none; }
        * { scrollbar-width: none; }
      `}</style>

      {/* Header */}
      <header
        className="sticky top-0 z-20 px-5 py-4 flex items-center justify-between"
        style={{
          backgroundColor: "#070c1699",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid #182030",
        }}
      >
        <div>
          <div className="flex items-baseline gap-2">
            <span
              className="font-mono text-base font-semibold tracking-[0.12em] uppercase"
              style={{ color: "#d8e4f0" }}
            >
              Bridge
            </span>
            <span
              className="font-mono text-[10px] tracking-widest"
              style={{ color: "#4e6278" }}
            >
              for Rydberg
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: "#4d9ef6",
              boxShadow: "0 0 5px #4d9ef6",
              animation: "termCursor 2.4s step-end infinite",
            }}
          />
          <span className="font-mono text-[11px]" style={{ color: "#4e6278" }}>
            {lastUpdated}
          </span>
        </div>
      </header>

      {/* Page */}
      <main className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-10 pb-20">
        <ModulesSection modules={modules} />
        <ContainersSection containers={containers} />
        <SessionsSection
          sessions={sessions}
          selectedSession={selectedSession}
          setSelectedSession={setSelectedSession}
        />
        <ScreenViewerSection
          sessions={sessions}
          lines={captureLines}
          loading={captureLoading}
          error={captureError}
          selectedSession={selectedSession}
          setSelectedSession={setSelectedSession}
        />
        <ResourcesSection resources={status?.resources} />
      </main>

      {/* Observe-only footer */}
      <div
        className="fixed bottom-0 left-0 right-0 py-2 px-4 flex items-center justify-center gap-2"
        style={{
          backgroundColor: "#070c16cc",
          backdropFilter: "blur(8px)",
          borderTop: "1px solid #182030",
        }}
      >
        <span
          className="font-mono text-[10px] uppercase tracking-[0.2em]"
          style={{ color: "#2e3e52" }}
        >
          observe only · no controls
        </span>
      </div>
    </div>
  );
}
