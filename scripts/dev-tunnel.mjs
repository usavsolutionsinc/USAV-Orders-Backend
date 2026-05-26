#!/usr/bin/env node
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
  log(`Install it, then re-run ${CYAN}pnpm dev:tunnel${RESET}:`);
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
  log(`${DIM}No account needed — the free quick-tunnel mode just works.${RESET}`);
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
  banner("Starting Cloudflare quick tunnel");
  tunnelProc = spawn(
    "cloudflared",
    ["tunnel", "--url", "http://localhost:3000", "--no-autoupdate"],
    { stdio: ["ignore", "pipe", "pipe"], shell: false },
  );

  let urlPrinted = false;
  const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

  const handle = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(`${DIM}[tunnel]${RESET} ${text}`);

    if (!urlPrinted) {
      const match = text.match(URL_RE);
      if (match) {
        urlPrinted = true;
        const url = match[0];
        setTimeout(() => {
          log("");
          log(`${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
          log(`${BOLD}${GREEN}  Public tunnel URL (open on ANY device):${RESET}`);
          log("");
          log(`  ${BOLD}${CYAN}${url}${RESET}`);
          log("");
          log(`${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
          log("");
          log(`${YELLOW}Notes:${RESET}`);
          log(`  • Real HTTPS → camera / getUserMedia / ZXing all work.`);
          log(`  • Works from any network — phone on cellular is fine.`);
          log(`  • URL changes each restart. For a stable URL set up a named`);
          log(`    Cloudflare tunnel (free account at dash.cloudflare.com).`);
          log("");
        }, 250);
      }
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
