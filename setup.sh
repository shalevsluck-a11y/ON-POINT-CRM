#!/usr/bin/env bash
# On Point CRM — Automated VPS setup script
# Run as: bash setup.sh [your-domain.com]
# Tested on Hostinger Ubuntu 22.04

set -e

DOMAIN="${1:-}"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> On Point CRM Setup"
echo "    Directory: $APP_DIR"
if [ -n "$DOMAIN" ]; then echo "    Domain:    $DOMAIN"; fi
echo ""

# ── 1. Node dependencies ────────────────────────────────────
echo "==> Installing Node dependencies..."
cd "$APP_DIR"
npm install --production

# ── 2. Generate PWA icons ────────────────────────────────────
echo "==> Generating PWA icons..."
npm install sharp 2>/dev/null || true
node scripts/generate-icons.js || echo "    (icon generation skipped — install sharp manually)"

# ── 3. Create logs directory ─────────────────────────────────
echo "==> Creating logs directory..."
mkdir -p "$APP_DIR/logs"

# ── 4. Start / restart PM2 ───────────────────────────────────
echo "==> Starting PM2..."
if command -v pm2 &>/dev/null; then
  pm2 describe onpoint-crm &>/dev/null && pm2 restart onpoint-crm || pm2 start "$APP_DIR/ecosystem.config.js"
  pm2 save
else
  echo "    WARN: PM2 not found. Install: sudo npm install -g pm2"
fi

# ── 5. Nginx config (optional) ───────────────────────────────
if [ -n "$DOMAIN" ] && command -v nginx &>/dev/null; then
  NGINX_CONF="/etc/nginx/sites-available/onpoint-crm"
  echo "==> Writing Nginx config for $DOMAIN..."
  sudo tee "$NGINX_CONF" > /dev/null <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX
  sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/onpoint-crm
  sudo nginx -t && sudo systemctl reload nginx
  echo "==> Nginx configured."

  # ── 6. SSL ───────────────────────────────────────────────
  if command -v certbot &>/dev/null; then
    echo "==> Requesting SSL certificate for $DOMAIN..."
    sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" || \
      echo "    SSL: run manually: sudo certbot --nginx -d $DOMAIN"
  else
    echo "    WARN: certbot not found. Install: sudo apt install certbot python3-certbot-nginx"
  fi
fi

echo ""
echo "==> Setup complete!"
echo "    App running on: http://localhost:3000"
if [ -n "$DOMAIN" ]; then echo "    Public URL: https://$DOMAIN"; fi
echo "    PM2 status: pm2 status"
echo "    View logs:  pm2 logs onpoint-crm"
