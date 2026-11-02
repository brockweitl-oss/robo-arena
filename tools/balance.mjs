// Runs the headless balance tournament (tests/balance) with low CPU priority.
import { spawn } from 'node:child_process';
import os from 'node:os';
const p = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', 'run', '--reporter=verbose'], {
  stdio: 'inherit', shell: true, env: { ...process.env, BALANCE: '1' },
});
try { os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* ignore */ }
p.on('exit', (c) => process.exit(c ?? 0));
