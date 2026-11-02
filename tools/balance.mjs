// Runs the headless balance tournament (tests/balance) with low CPU priority.
import { spawn } from 'node:child_process';
import os from 'node:os';
const p = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--reporter=verbose'], {
  stdio: 'inherit', env: { ...process.env, BALANCE: '1', BALANCE_N: process.env.BALANCE_N ?? '200' },
});
try { os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* ignore */ }
p.on('exit', (c) => process.exit(c ?? 0));
