import { defineConfig } from '@playwright/test';

// End-to-end tests run against production builds of the real stack:
// Next.js -> NestJS -> Postgres. Production builds, because that's what we ship
// (and dev mode compiles pages on first visit, which makes tests flaky).
// Start the database first with `docker compose up -d`.
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000' },
  webServer: [
    {
      command: 'npm run build && npm run start:prod',
      cwd: '../api',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: true,
      timeout: 300_000,
    },
    {
      command: 'npm run build && npm run start',
      // Trailing slash on purpose: production had one, and it broke every call.
      env: { API_URL: 'http://localhost:4000/' },
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 300_000,
    },
  ],
});
