import { defineConfig } from '@playwright/test';

// End-to-end tests run against production builds of the real stack:
// Next.js -> NestJS -> Postgres. Production builds, because that's what we ship
// (and dev mode compiles pages on first visit, which makes tests flaky).
// Start the database first with `docker compose up -d`.
//
// BASE_URL=https://fernleaf.vercel.app npm run test:e2e runs the same suite
// against the live site instead (tests that create data skip themselves).
const liveUrl = process.env.BASE_URL;

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: liveUrl ?? 'http://localhost:3000' },
  // Free hosting is slower than localhost, so allow more time there.
  expect: { timeout: liveUrl ? 15_000 : 10_000 },
  // Two browsers at a time: enough to be quick, light enough for a laptop
  // that's also running Postgres, the API and the web server.
  workers: 2,
  webServer: liveUrl
    ? undefined
    : [
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
