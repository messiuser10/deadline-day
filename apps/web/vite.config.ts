import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiPort = process.env.PORT ?? '3001';

/** Writes .br and .gz next to each text asset so the server can send them pre-compressed. */
function precompress(): Plugin {
  let outDir = 'dist';
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  return {
    name: 'deadline-day:precompress',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const file of walk(outDir)) {
        if (!/\.(js|css|html|svg|json|txt)$/.test(file)) continue;
        const body = readFileSync(file);
        if (body.length < 1024) continue;
        writeFileSync(`${file}.br`, brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
        writeFileSync(`${file}.gz`, gzipSync(body, { level: 9 }));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), precompress()],
  build: {
    rollupOptions: {
      output: {
        // Libraries change less often than the app, so they get their own long-cached chunks.
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client', 'react-router'],
          vendor: ['@tanstack/react-query', 'zustand', 'socket.io-client', 'zod', 'qrcode'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
      '/socket.io': { target: `http://localhost:${apiPort}`, ws: true },
    },
  },
});
