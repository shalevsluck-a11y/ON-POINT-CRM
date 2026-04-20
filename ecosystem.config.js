// PM2 ecosystem config — production VPS deployment
// Usage: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'onpoint-crm',
      script: 'npx',
      args: 'serve . -p 3000 -s',
      cwd: __dirname,
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Auto-restart on crash
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      // Logging
      out_file: './logs/out.log',
      error_file: './logs/err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
