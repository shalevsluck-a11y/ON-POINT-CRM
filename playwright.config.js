module.exports = {
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    baseURL: 'https://crm.onpointprodoors.com',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
};
