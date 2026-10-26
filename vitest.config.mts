import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: ['lib/**/*.test.ts', 'scripts/**/*.test.mjs'],
    // Tests pin the clock in local time; keep the zone fixed so results don't depend on the machine.
    env: { TZ: 'Asia/Kolkata' },
  },
});
