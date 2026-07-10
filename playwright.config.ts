import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:4173/fareproof/', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev --workspace @fareproof/web -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/fareproof/',
    reuseExistingServer: false,
    env: {
      VITE_FAREPROOF_AUTH_VERIFIER:
        'N11SRzDopkUfrxH3FL90Mg6NNYw9aElsw77sEYnyPnjDI9OESNxHVIVIE7j52EDOHCQFOlAD4j/knvzuZfhnVEbM',
    },
  },
});