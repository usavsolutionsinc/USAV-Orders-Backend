#!/usr/bin/env node
/**
 * Starts Next.js dev (localhost:3000) + a pre-configured Cloudflare named tunnel.
 *
 * Usage:
 *   pnpm dev:tunnel:named
 *
 * Auth (pick one — token avoids `cloudflared tunnel login` / cert.pem conflicts):
 *   CLOUDFLARE_TUNNEL_TOKEN=…   connector token from Zero Trust → Tunnels → Configure
 *                               (long eyJ… string — NOT the tunnel UUID)
 *   CLOUDFLARE_TUNNEL_ID=…      optional UUID when using ~/.cloudflared/<id>.json
 *   CLOUDFLARE_DEV_TUNNEL_NAME=…  fallback: `cloudflared tunnel run <name>`
 *
 * Cloudflare dashboard → Published application → Service URL:
 *   http://localhost:3000
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env"), quiet: true });

const DEV_PORT = Number(process.env.PORT || process.env.DEV_PORT || 3000);
const DEFAULT_TUNNEL = "usav-dev";
// Display-only public hostname. With a connector token the real hostname comes
// from the Cloudflare dashboard route; override here when the token points at a
// different tunnel than the default `usav-dev` one.
const DEFAULT_HOST =
  process.env.CLOUDFLARE_DEV_TUNNEL_HOST?.trim() || "usav-dev.michaelgarisek.com";

const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const log = (...args) => console.log(...args);
const banner = (title) => {
  log("");
  log(`${BOLD}${BLUE}━━━ ${title} ━━━${RESET}`);
  log("");
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cliArgs = process.argv.slice(2).filter((a) => a !== "--");
const rawTokenEnv = process.env.CLOUDFLARE_TUNNEL_TOKEN?.trim() || "";
const explicitTunnelId = process.env.CLOUDFLARE_TUNNEL_ID?.trim() || "";
const tunnelName =
  process.env.CLOUDFLARE_DEV_TUNNEL_NAME?.trim() ||
  cliArgs[0]?.trim() ||
  DEFAULT_TUNNEL;

function isConnectorToken(value) {
  return value.length > 50 && !UUID_RE.test(value);
}

function credentialsPathForTunnelId(tunnelId) {
  return resolve(homedir(), ".cloudflared", `${tunnelId}.json`);
}

function resolveTunnelAuth() {
  if (rawTokenEnv && isConnectorToken(rawTokenEnv)) {
    return { mode: "token", token: rawTokenEnv };
  }

  const tunnelId =
    explicitTunnelId || (UUID_RE.test(rawTokenEnv) ? rawTokenEnv : "");
  if (tunnelId) {
    const credPath = credentialsPathForTunnelId(tunnelId);
    if (existsSync(credPath)) {
      return { mode: "credentials", tunnelId, credPath };
    }
    return {
      mode: "misconfigured",
      tunnelId,
      usedUuidAsToken: Boolean(rawTokenEnv && UUID_RE.test(rawTokenEnv)),
    };
  }

  if (tunnelName) {
    return { mode: "name", tunnelName };
  }

  return { mode: "missing" };
}

const tunnelAuth = resolveTunnelAuth();

/** Avoid ~/.cloudflared/config.yml (e.g. hermes-mac) hijacking dev tunnel auth. */
function createIsolatedConfigPath() {
  const dir = mkdtempSync(resolve(tmpdir(), "usav-cf-tunnel-"));
  const configPath = resolve(dir, "config.yml");
  writeFileSync(configPath, "ingress:\n  - service: http_status:404\n");
  return configPath;
}

const isolatedConfigPath = createIsolatedConfigPath();

function ensureCloudflared() {
  const check = spawnSync("cloudflared", ["--version"], { encoding: "utf8" });
  if (check.status === 0) {
    log(`${DIM}cloudflared: ${check.stdout.trim()}${RESET}`);
    return;
  }

  log(`${RED}${BOLD}cloudflared is not installed.${RESET}`);
  log("");
  log(`Install it, then re-run ${CYAN}pnpm dev:tunnel:named${RESET}:`);
  log("");
  if (platform() === "darwin") {
    log(`  ${GREEN}brew install cloudflared${RESET}`);
  } else if (platform() === "win32") {
    log(`  ${GREEN}winget install --id Cloudflare.cloudflared${RESET}`);
  } else {
    log(
      `  Download: ${CYAN}https://github.com/cloudflare/cloudflared/releases${RESET}`,
    );
  }
  log("");
  process.exit(1);
}

function ensureTunnelAuth() {
  if (tunnelAuth.mode === "misconfigured") {
    log(`${RED}${BOLD}Invalid CLOUDFLARE_TUNNEL_TOKEN.${RESET}`);
    log("");
    if (tunnelAuth.usedUuidAsToken) {
      log(
        `You set a ${BOLD}tunnel UUID${RESET} (${DIM}${tunnelAuth.tunnelId}${RESET}), not the connector token.`,
      );
      log(
        `cloudflared rejects UUIDs passed to ${CYAN}--token${RESET} with "Provided Tunnel token is not valid."`,
      );
      log("");
    }
    log(`Get the real connector token:`);
    log(
      `  Cloudflare Zero Trust → Networks → Tunnels → ${CYAN}${tunnelName}${RESET} → Configure`,
    );
    log(
      `  Copy the long token from the install command (${CYAN}cloudflared tunnel run --token eyJ…${RESET}).`,
    );
    log("");
    log(`Put it in ${CYAN}.env.local${RESET}:`);
    log(`  ${CYAN}CLOUDFLARE_TUNNEL_TOKEN=eyJ…${RESET}`);
    log("");
    log(`${DIM}Alternative: save credentials JSON as${RESET}`);
    log(`  ${DIM}${credentialsPathForTunnelId(tunnelAuth.tunnelId)}${RESET}`);
    log(`${DIM}and set CLOUDFLARE_TUNNEL_ID=${tunnelAuth.tunnelId}${RESET}`);
    log("");
    process.exit(1);
  }

  if (tunnelAuth.mode === "missing") {
    log(`${YELLOW}No tunnel auth configured in .env.local.${RESET}`);
    log("");
    log(`Add the connector token from Cloudflare Zero Trust → Tunnels → Configure:`);
    log(`  ${CYAN}CLOUDFLARE_TUNNEL_TOKEN=eyJ…${RESET}`);
    log("");
    log(
      `${DIM}Or set ${CYAN}CLOUDFLARE_TUNNEL_ID${RESET}${DIM} with ~/.cloudflared/<uuid>.json, or ${CYAN}CLOUDFLARE_DEV_TUNNEL_NAME${RESET}${DIM} + credentials.${RESET}`,
    );
    log("");
    process.exit(1);
  }
}

function tunnelSpawnArgs() {
  const base = [
    "tunnel",
    "--no-autoupdate",
    "--config",
    isolatedConfigPath,
    "run",
  ];

  switch (tunnelAuth.mode) {
    case "token":
      return [...base, "--token", tunnelAuth.token];
    case "credentials":
      return [
        ...base,
        tunnelAuth.tunnelId,
        "--credentials-file",
        tunnelAuth.credPath,
      ];
    case "name":
      return [...base, tunnelAuth.tunnelName];
    default:
      return base;
  }
}

let nextProc = null;
let tunnelProc = null;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("");
  log(`${DIM}Shutting down dev server and tunnel…${RESET}`);
  try {
    tunnelProc?.kill("SIGTERM");
  } catch {}
  try {
    nextProc?.kill("SIGTERM");
  } catch {}
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function startNext() {
  banner(`Starting Next.js dev server (localhost:${DEV_PORT})`);
  nextProc = spawn("next", ["dev", "--turbopack", "-p", String(DEV_PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: { ...process.env, PORT: String(DEV_PORT) },
  });
  nextProc.stdout.on("data", (d) =>
    process.stdout.write(`${DIM}[next]${RESET} ${d}`),
  );
  nextProc.stderr.on("data", (d) =>
    process.stderr.write(`${DIM}[next]${RESET} ${d}`),
  );
  nextProc.on("exit", (code) => {
    if (!shuttingDown) {
      log(`${RED}next dev exited with code ${code}${RESET}`);
      shutdown(code ?? 1);
    }
  });
}

function startTunnel() {
  const authLabel =
    tunnelAuth.mode === "token"
      ? "connector token"
      : tunnelAuth.mode === "credentials"
        ? `tunnel ${tunnelAuth.tunnelId}`
        : `named tunnel "${tunnelAuth.tunnelName}"`;
  banner(`Starting Cloudflare dev tunnel (${authLabel})`);
  log(`${DIM}Route in Zero Trust should point to ${CYAN}http://localhost:${DEV_PORT}${RESET}${DIM}.${RESET}`);
  log(`${DIM}Public URL: ${CYAN}https://${DEFAULT_HOST}${RESET}`);
  log("");

  tunnelProc = spawn("cloudflared", tunnelSpawnArgs(), {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  let readyPrinted = false;
  const handle = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(`${DIM}[tunnel]${RESET} ${text}`);

    if (
      !readyPrinted &&
      /Registered tunnel connection|Connection established/i.test(text)
    ) {
      readyPrinted = true;
      setTimeout(() => {
        log("");
        log(`${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
        log(`${BOLD}${GREEN}  Named dev tunnel is up${RESET}`);
        log("");
        log(`  ${BOLD}${CYAN}https://${DEFAULT_HOST}${RESET}`);
        log(`  ${DIM}→ http://localhost:${DEV_PORT}${RESET}`);
        log("");
        log(`${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
        log("");
      }, 250);
    }
  };

  tunnelProc.stdout.on("data", handle);
  tunnelProc.stderr.on("data", handle);
  tunnelProc.on("exit", (code) => {
    if (!shuttingDown) {
      log(`${RED}cloudflared exited with code ${code}${RESET}`);
      if (tunnelAuth.mode === "token") {
        log(
          `${YELLOW}Tip:${RESET} refresh ${CYAN}CLOUDFLARE_TUNNEL_TOKEN${RESET} from Cloudflare Zero Trust → Tunnels → Configure (use the long ${CYAN}eyJ…${RESET} token, not the tunnel UUID).`,
        );
      } else {
        log(
          `${YELLOW}Tip:${RESET} set ${CYAN}CLOUDFLARE_TUNNEL_TOKEN${RESET} in .env.local to skip cert.pem / tunnel login.`,
        );
      }
      shutdown(code ?? 1);
    }
  });
}

ensureCloudflared();
ensureTunnelAuth();
startNext();
setTimeout(startTunnel, 1500);
