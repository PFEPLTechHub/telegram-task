## Deploying Telegram Task Manager Bot on Hostinger VPS (Ubuntu 24.04)

This guide shows how to deploy the Node.js + Telegraf + MySQL app to a Hostinger VPS with a public web UI and a resilient bot process.

### Prerequisites
- Hostinger VPS (Ubuntu 22.04/24.04) with root SSH access
- A domain or subdomain (optional, recommended)
- Telegram Bot Token from @BotFather
- MySQL server (on the VPS or managed)

### 1) Connect to the VPS
```bash
ssh root@YOUR_SERVER_IP
```

### 2) Install dependencies
```bash
apt update -y && apt upgrade -y
apt install -y curl build-essential git ufw

# Node.js LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt install -y nodejs

# PM2 (process manager)
npm i -g pm2

# (Optional) Nginx reverse proxy
apt install -y nginx
```

Verify:
```bash
node -v && npm -v && pm2 -v
```

### 3) Clone your project
```bash
cd /var/www
git clone YOUR_REPO_URL tel-bot-main
cd tel-bot-main
npm ci || npm install
```

### 4) Configure environment
Create a `.env` file (use `.env.example` as a template):
```bash
cp .env.example .env
nano .env
```
Fill values:
- `TELEGRAM_BOT_TOKEN` from BotFather
- `DB_*` credentials (local MySQL or remote)
- `PORT` express port (e.g., 3000)
- `PUBLIC_BASE_URL` public base URL for web UI buttons (your domain)
- For webhook mode set `NODE_ENV=production` and `WEBHOOK_URL=https://your-domain.com/telegram` (see section 8). For polling mode leave `WEBHOOK_URL` empty.

### 5) Database
Install MySQL if hosting on the VPS:
```bash
apt install -y mysql-server
mysql_secure_installation
```

Create database and user:
```sql
CREATE DATABASE task_manager DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'botuser'@'localhost' IDENTIFIED BY 'STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON task_manager.* TO 'botuser'@'localhost';
FLUSH PRIVILEGES;
```

Run migrations (if you use the provided SQL files):
```bash
mysql -u botuser -p task_manager < migrations/create_notes_table.sql
mysql -u botuser -p task_manager < migrations/create_task_cc_table.sql
mysql -u botuser -p task_manager < migrations/add_completion_reply.sql
```

If you have a dump of tables, import it similarly with `mysql`.

### 6) Start with PM2 (polling mode)
Polling is simplest and does not require public inbound webhooks.
```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup systemd -u $(whoami) --hp /root
```

Common PM2 commands:
```bash
pm2 status
pm2 logs --lines 200
pm2 restart tel-bot
pm2 stop tel-bot
```

### 7) Reverse proxy for the web UI (Nginx)
Expose the static frontend and API under your domain.
Create a server block:
```bash
cat >/etc/nginx/sites-available/tel-bot <<'NGINX'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/tel-bot /etc/nginx/sites-enabled/tel-bot
nginx -t && systemctl reload nginx
```

Optionally add a free SSL cert with certbot.

### 8) Webhook mode (optional)
The app supports webhooks when `NODE_ENV=production` and `WEBHOOK_URL` are set. Example:
```
NODE_ENV=production
WEBHOOK_URL=https://your-domain.com/telegram
```
Update Nginx to forward `/telegram` to the app root (the bot mounts webhook at `/` inside the app, so we map that path):
```nginx
location /telegram {
    proxy_pass http://127.0.0.1:3000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```
Reload Nginx and restart the app. The code will call `setWebhook(WEBHOOK_URL)` on boot.

### 9) Firewall
```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

### 10) Logs and troubleshooting
- App logs: `logs/combined.log`, `logs/error.log` and `pm2 logs`
- Health check: `curl -f http://127.0.0.1:3000/ping` should return `OK`
- Verify bot can message: send `/start` to your bot

### 11) Updating the app
```bash
cd /var/www/tel-bot-main
git pull
npm ci || npm install
pm2 restart tel-bot
```

### Environment variables reference
```
TELEGRAM_BOT_TOKEN=
DB_HOST=
DB_USER=
DB_PASSWORD=
DB_NAME=
DB_PORT=3306
PORT=3000
NODE_ENV=production
WEBHOOK_URL=
LOG_LEVEL=info
PUBLIC_BASE_URL=
```

Notes:
- If you keep polling mode, leave `WEBHOOK_URL` empty; the bot will use polling.
- Ensure `PUBLIC_BASE_URL` matches your domain so buttons/links work properly from Telegram.


