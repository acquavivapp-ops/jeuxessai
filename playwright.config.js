import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const testPort = Number(process.env.BLUE_NIGHT_TEST_PORT || 4173);
if (!Number.isInteger(testPort) || testPort < 1 || testPort > 65535) throw new Error('Invalid Blue Night test port');
const baseURL = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: './tests/browser',
  timeout: 35_000,
  // The real photographic city is CPU intensive in this cloud runner. Keep
  // public input and short audio/effect observations on one browser at a time.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    launchOptions: existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] } : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: { command: 'npm run dev', url: baseURL, env: { ...process.env, PORT: String(testPort) }, reuseExistingServer: !process.env.CI, timeout: 10_000 },
});
