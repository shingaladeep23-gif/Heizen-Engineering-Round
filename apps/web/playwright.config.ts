import { defineConfig } from '@playwright/test';

// End-to-end tests run against production builds of the real stack:
// Next.js -> NestJS -> Postgres. Production builds, because that's what we ship
// (and dev mode compiles pages on first visit, which makes tests flaky).
// Start the database first with `docker compose up -d`.
//
// BASE_URL=https://fernleaf.vercel.app npm run test:e2e runs the same suite
// against the live site instead (tests that create data skip themselves).
// The live-only checks then need QA_DATABASE_URL, so they can remove the
// test data they create (see e2e/qa-cleanup.ts).
const liveUrl = process.env.BASE_URL;

export default defineConfig({
  testDir: './e2e',
  globalSetup: liveUrl ? './e2e/qa-cleanup.ts' : undefined,
  use: { baseURL: liveUrl ?? 'http://localhost:3000' },
  // Free hosting is slower than localhost, so allow more time there.
  expect: { timeout: liveUrl ? 15_000 : 10_000 },
  // Two browsers at a time: enough to be quick, light enough for a laptop
  // that's also running Postgres, the API and the web server. One on the live
  // site, so the live checks never trip over each other's figures.
  workers: liveUrl ? 1 : 2,
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
