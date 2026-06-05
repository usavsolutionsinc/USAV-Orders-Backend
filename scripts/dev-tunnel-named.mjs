#!/usr/bin/env node
// Stable-URL dev tunnel. Unlike scripts/dev-tunnel.mjs (random quick-tunnel
// host), this runs the pre-created named Cloudflare tunnel "usav-dev", which
// always serves the same hostname. DNS + ~/.cloudflared/config.yml ingress
// must already point that hostname at http://localhost:3000.
import { spawn, spawnSync } from "node:child_process";
import { platform } from "node:os";

const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const TUNNEL_NAME = "usav-dev";
const PUBLIC_URL = "https://app.michaelgarisek.com";

const log = (...args) => console.log(...args);
const banner = (title) => {
  log("");
  log(`${BOLD}${BLUE}━━━ ${title} ━━━${RESET}`);
  log("");
};

function ensureCloudflared() {
  const check = spawnSync("cloudflared", ["--version"], { encoding: "utf8" });
  if (check.status === 0) {
    log(`${DIM}cloudflared: ${check.stdout.trim()}${RESET}`);
    return;
  }
  log(`${RED}${BOLD}cloudflared is not installed.${RESET}`);
  log("");
  if (platform() === "darwin") {
    log(`  ${GREEN}brew install cloudflared${RESET}`);
  } else if (platform() === "win32") {
    log(`  ${GREEN}winget install --id Cloudflare.cloudflared${RESET}`);
  } else {
    log(`  Download: ${CYAN}https://github.com/cloudflare/cloudflared/releases${RESET}`);
  }
  log("");
  process.exit(1);
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
  banner("Starting Next.js dev server (localhost:3000)");
  nextProc = spawn("next", ["dev", "--turbopack"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
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
  banner(`Starting named Cloudflare tunnel "${TUNNEL_NAME}"`);
  tunnelProc = spawn(
    "cloudflared",
    ["tunnel", "run", TUNNEL_NAME],
    { stdio: ["ignore", "pipe", "pipe"], shell: false },
  );

  let bannerPrinted = false;
  const handle = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(`${DIM}[tunnel]${RESET} ${text}`);
    // Print the stable URL once the tunnel has registered a connection.
    if (!bannerPrinted && /Registered tunnel connection|Connection .* registered/i.test(text)) {
      bannerPrinted = true;
      setTimeout(() => {
        log("");
        log(`${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
        log(`${BOLD}${GREEN}  Stable tunnel URL (same every run):${RESET}`);
        log("");
        log(`  ${BOLD}${CYAN}${PUBLIC_URL}${RESET}`);
        log("");
        log(`${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
        log("");
        log(`${YELLOW}Notes:${RESET}`);
        log(`  • Real HTTPS → camera / getUserMedia / ZXing all work.`);
        log(`  • Reserved subdomain "app" → resolves to the default org`);
        log(`    (avoids the tenant-slug "No active staff" trap).`);
        log("");
      }, 250);
    }
  };

  tunnelProc.stdout.on("data", handle);
  tunnelProc.stderr.on("data", handle);
  tunnelProc.on("exit", (code) => {
    if (!shuttingDown) {
      log(`${RED}cloudflared exited with code ${code}${RESET}`);
      shutdown(code ?? 1);
    }
  });
}

ensureCloudflared();
startNext();
setTimeout(startTunnel, 1500);
