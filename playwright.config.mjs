import {defineConfig,devices} from '@playwright/test';

export default defineConfig({
  testDir:'./e2e',
  timeout:30000,
  expect:{timeout:5000},
  fullyParallel:false,
  workers:1,
  reporter:[['line']],
  use:{
    baseURL:'http://127.0.0.1:4173',
    locale:'pt-BR',
    timezoneId:'America/Sao_Paulo',
    trace:'retain-on-failure',
    screenshot:'only-on-failure'
  },
  webServer:{
    command:'PORT=4173 ALLOWED_ORIGINS=http://127.0.0.1:4173 BOT_USERNAME=rmdtxtml_test_bot node src/server.mjs',
    url:'http://127.0.0.1:4173/api/health',
    reuseExistingServer:false,
    timeout:15000
  },
  projects:[{
    name:'chromium-mobile',
    use:{...devices['iPhone 15'],browserName:'chromium',viewport:{width:390,height:844}}
  }]
});
