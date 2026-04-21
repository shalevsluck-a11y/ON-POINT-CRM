const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self), payment=()');
  next();
});

app.use(express.static(path.join(__dirname), {
  setHeaders(res, filePath) {
    // SW and manifest: always revalidate
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return;
    }
    if (filePath.endsWith('manifest.json')) {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    // Vendor JS (supabase.min.js): immutable, cache 1 year — never changes between deploys
    if (filePath.endsWith('supabase.min.js')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
    // HTML and JS: must-revalidate so phones always get fresh code after a deploy
    if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return;
    }
    // CSS: 1-day TTL — SW fetches fresh copies on load anyway
    if (filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return;
    }
    // Images and icons: cache for 1 year (stable assets)
    if (filePath.match(/\.(png|jpg|jpeg|svg|webp|ico|woff2?)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
  },
}));

// SPA fallback — all routes serve index.html
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`On Point CRM running on port ${PORT}`);
});
