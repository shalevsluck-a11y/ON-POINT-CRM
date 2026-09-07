// Fails if the public-asset whitelist in server.js ever exposes the repo root again.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../server.js', 'utf8');
const m = src.match(/const PUBLIC_ASSET = (\/.*\/);/);
if (!m) { console.error('PUBLIC_ASSET regex not found in server.js'); process.exit(1); }
const R = eval(m[1]);
const allow = ['/js/app.js', '/css/refine.css', '/assets/logo.jpg', '/sw.js', '/manifest.json', '/public/sounds/chime.mp3', '/apple-touch-icon.png', '/offline.html', '/index.html'];
const block = ['/server.js', '/.git/HEAD', '/.git/config', '/.secrets/anthropic.key', '/js/app.js.bak-x', '/css/refine.css.bak-1', '/supabase/migrations/047_lock_jobs_from_anon.sql', '/package.json', '/js/../server.js', '/index.html.bak-1', '/DEPLOY.md', '/node_modules/express/package.json', '/ecosystem.config.js', '/docs/archive/README.md', '/tests/rbac-test.js'];
for (const p of allow) if (!R.test(p)) { console.error('should allow', p); process.exit(1); }
for (const p of block) if (R.test(p)) { console.error('should block', p); process.exit(1); }
console.log('static-whitelist: PASS (allows ' + allow.length + ', blocks ' + block.length + ')');
