#!/usr/bin/env node
import { spawn } from "node:child_process";

const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const lines = [
  ``,
  `${BOLD}${BLUE}━━━ Phone-over-USB dev (Android Chrome) ━━━${RESET}`,
  ``,
  `${BOLD}On the phone (one-time):${RESET}`,
  `  1. Settings → About phone → tap "Build number" 7x to enable Developer options`,
  `  2. Settings → System → Developer options → enable ${CYAN}USB debugging${RESET}`,
  `  3. Plug phone into laptop via USB, tap "Allow USB debugging" on the prompt`,
  ``,
  `${BOLD}On the laptop (each session):${RESET}`,
  `  1. Open Chrome → ${CYAN}chrome://inspect/#devices${RESET}`,
  `  2. Click ${CYAN}"Port forwarding…"${RESET}`,
  `  3. Add row: ${GREEN}Port 3000${RESET}  →  ${GREEN}localhost:3000${RESET}`,
  `  4. Check ${CYAN}"Enable port forwarding"${RESET}, click Done`,
  ``,
  `${BOLD}On the phone:${RESET}`,
  `  → Open Chrome and go to ${GREEN}http://localhost:3000${RESET}`,
  `  → Camera/getUserMedia works because phone treats it as a secure context`,
  ``,
  `${BOLD}${YELLOW}Debugging the phone's page from the laptop:${RESET}`,
  `  Back in chrome://inspect, your phone's tab appears under "Remote Target".`,
  `  Click ${CYAN}"inspect"${RESET} → full DevTools for the phone page (console,`,
  `  network, ZXing decode logs, etc.).`,
  ``,
  `${DIM}iOS note: Chrome's port forwarding is Android-only. For iPhone, use a${RESET}`,
  `${DIM}cloudflared tunnel or mkcert+HTTPS instead.${RESET}`,
  ``,
  `${BOLD}${BLUE}Starting Next.js dev server…${RESET}`,
  ``,
];

console.log(lines.join("\n"));

const child = spawn("next", ["dev", "--turbopack"], {
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => process.exit(code ?? 0));
