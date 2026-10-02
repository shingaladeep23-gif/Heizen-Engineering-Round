import { defineConfig } from '@playwright/test';

// End-to-end tests run against the real stack: Next.js -> NestJS -> Postgres.
// Start the database first with `docker compose up -d`.
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000' },
  webServer: [
    {
      command: 'npm run start:dev',
      cwd: '../api',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
