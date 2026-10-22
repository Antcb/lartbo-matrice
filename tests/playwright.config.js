// Configuration des tests navigateur. Tout tourne en local : la base Supabase est remplacée
// par une fausse base en mémoire (fixtures/mock-supabase.js) et toute requête extérieure est bloquée.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    // Seconde barrière, au niveau du navigateur : aucun nom de domaine extérieur ne peut être résolu.
    // Même si une requête échappait au routage des tests, elle ne pourrait atteindre aucun service réel.
    launchOptions: { args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'node serve.mjs',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
