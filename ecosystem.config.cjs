module.exports = {
  apps: [
    {
      name: "foundry",
      script: "dist/index.js",
      cwd: __dirname,
      interpreter: "node",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
      },
      // Load .env file — dotenv is called inside dist/index.js, so env vars
      // just need to be present in the shell. PM2 reads .env automatically
      // when env_file is set (PM2 >= 5.3).
      env_file: ".env",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/error.log",
      out_file: "logs/out.log",
      merge_logs: true,
    },
  ],
};
