// Pretty-print tests/balance/report.json
import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync('tests/balance/report.json', 'utf8'));
console.log(`n=${d.n} field=${d.field} (${d.seconds.toFixed(0)} s)`);
for (const [slot, parts] of Object.entries(d.report))
  for (const [id, v] of Object.entries(parts)) {
    const bad = v.vsDefault > 0.62 || v.vsDefault < 0.38 || v.field > 0.6 || v.field < 0.4;
    console.log(`${slot.padEnd(5)} ${id.padEnd(12)} vsDefault ${(v.vsDefault * 100).toFixed(0).padStart(3)}%  field ${(v.field * 100).toFixed(0).padStart(3)}%${bad ? '  <--' : ''}`);
  }
