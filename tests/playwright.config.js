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
    // Seconde barrière, au niveau du navigateur : aucun nom de domaine extérieur ne peut être résolu, et aucun
    // proxy n'est utilisé (sinon le proxy résoudrait les noms à la place du navigateur). Même si une requête
    // échappait au routage des tests, elle ne pourrait atteindre aucun service réel.
    launchOptions: {
      args: ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'],
      env: { ...process.env, HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '', ALL_PROXY: '', all_proxy: '' },
    },
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'node serve.mjs',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: false,   // toujours un serveur neuf : jamais le code d'une autre copie du dépôt
    timeout: 20_000,
  },
});
