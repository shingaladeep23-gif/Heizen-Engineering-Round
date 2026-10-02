// Imported first in main.ts so env vars exist before any module reads them.
try {
  process.loadEnvFile(); // local .env; in production the host sets real env vars
} catch {}
