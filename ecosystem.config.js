// PM2 ecosystem config — production VPS deployment
// Usage: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'onpoint-crm',
      script: 'server.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      // Logging
      out_file: './logs/out.log',
      error_file: './logs/err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
