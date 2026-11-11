// Starts the Next.js standalone server after copying static assets next to it,
// which `output: 'standalone'` leaves to the deploy step (the Dockerfile does the same).
import { cpSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const standalone = '.next/standalone';
if (!existsSync(`${standalone}/server.js`)) {
  console.error('Run `pnpm build` first.');
  process.exit(1);
}
cpSync('.next/static', `${standalone}/.next/static`, { recursive: true });
if (existsSync('public')) cpSync('public', `${standalone}/public`, { recursive: true });

const child = spawn(process.execPath, ['server.js'], {
  cwd: standalone,
  stdio: 'inherit',
  env: { HOSTNAME: '0.0.0.0', ...process.env },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
