import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { appendFileSync, mkdirSync } from 'node:fs';

/** Dev-only: play-test telemetry sink, appends to playtest/telemetry.jsonl */
const sink = (req: any, res: any) => {
      if (req.method !== 'POST') return res.end();
      let body = '';
      req.on('data', (c: Buffer) => (body += c));
      req.on('end', () => {
        try {
          mkdirSync(resolve(import.meta.dirname, 'playtest'), { recursive: true });
          appendFileSync(resolve(import.meta.dirname, 'playtest/telemetry.jsonl'), body.trim() + '\n');
        } catch (e) {
          console.error('telemetry write failed', e);
        }
        res.statusCode = 204;
        res.end();
      });
};
const telemetry = () => ({
  name: 'telemetry-sink',
  configureServer(server: any) {
    server.middlewares.use('/__telemetry', sink);
  },
  // `vite preview` of a local play-test build (built with VITE_TELEMETRY_URL=/__telemetry)
  configurePreviewServer(server: any) {
    server.middlewares.use('/__telemetry', sink);
  },
});

export default defineConfig({
  base: './',
  plugins: [telemetry()],
  server: { watch: { ignored: ['**/playtest/**'] } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        viewer: resolve(import.meta.dirname, 'viewer.html'),
      },
    },
  },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
