module.exports = {
  apps: [
    {
      name: "telegrambot2",
      script: "bot.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "800M",
      env: {
        NODE_ENV: "production",
        HEADLESS: "true",
        HANDLER_TIMEOUT_MS: "300000",
        CONCURRENCY: "2",
      },
    },
  ],
};
