const { spawn } = require('child_process');
const waitOn = require('wait-on');

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';

let electronProcess;
const nextProcess = spawn(npmCmd, ['run', 'dev'], {
  stdio: 'inherit',
  env: process.env,
});

function shutdown(code = 0) {
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill('SIGTERM');
  }

  if (!nextProcess.killed) {
    nextProcess.kill('SIGTERM');
  }

  process.exit(code);
}

nextProcess.on('exit', (code) => {
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill('SIGTERM');
  }

  process.exit(code ?? 0);
});

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

waitOn({
  resources: ['http-get://127.0.0.1:3000'],
  timeout: 120000,
}).then(() => {
  electronProcess = spawn(npxCmd, ['electron', '.'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_START_URL: 'http://127.0.0.1:3000',
    },
  });

  electronProcess.on('exit', (code) => {
    if (!nextProcess.killed) {
      nextProcess.kill('SIGTERM');
    }

    process.exit(code ?? 0);
  });
}).catch((error) => {
  console.error('Electron dev startup failed:', error.message);
  shutdown(1);
});
