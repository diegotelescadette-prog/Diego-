import { defineConfig, devices } from '@playwright/test';

// E2E contra o app em execução (npm run build && npm start) + stack Supabase local.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: process.env.APP_URL ?? 'http://localhost:3000', trace: 'off', locale: 'pt-BR', timezoneId: 'America/Campo_Grande' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'celular', use: { ...devices['Pixel 7'] } },
  ],
});
