#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu server (Oracle Arm VM). Run as the normal user (ubuntu), not root:
#   DOMAIN=yourname.duckdns.org bash setup_server.sh
# Safe to run again. Does not touch your data or your .env.
set -euo pipefail
: "${DOMAIN:?set DOMAIN, e.g. DOMAIN=yourname.duckdns.org bash setup_server.sh}"
APP=/opt/halfspace
REPO=https://github.com/Abhi-2104/The-HalfSpace.git

echo "== packages"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git python3-venv python3-pip sqlite3 fail2ban unattended-upgrades \
    debian-keyring debian-archive-keyring apt-transport-https curl gpg iptables-persistent
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y && sudo apt-get install -y caddy
fi

echo "== firewall (Oracle's Ubuntu images block everything except SSH inside the VM as well)"
for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport $p -j ACCEPT
done
sudo netfilter-persistent save

echo "== app"
sudo mkdir -p $APP && sudo chown "$USER":"$USER" $APP
[ -d $APP/.git ] || git clone "$REPO" $APP
cd $APP
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r deploy/requirements.lock
mkdir -p data backups
[ -f .env ] || { cp deploy/env.example .env; chmod 600 .env; echo "created .env: edit it before starting (nano $APP/.env)"; }

echo "== services"
sudo cp deploy/halfspace.service /etc/systemd/system/halfspace.service
echo "DOMAIN=$DOMAIN" | sudo tee /etc/default/caddy-domain >/dev/null
sudo mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironmentFile=/etc/default/caddy-domain\n' | sudo tee /etc/systemd/system/caddy.service.d/domain.conf >/dev/null
sudo cp deploy/Caddyfile.template /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable halfspace caddy
sudo systemctl restart caddy

echo "== weekly backup (Sunday 03:30)"
( crontab -l 2>/dev/null | grep -v halfspace-backup; echo "30 3 * * 0 $APP/deploy/backup.sh # halfspace-backup" ) | crontab -
chmod +x deploy/*.sh

cat <<MSG

Done. Next: (1) upload and unpack the data bundle into $APP, (2) edit $APP/.env, (3) sudo systemctl start halfspace.
Then open https://$DOMAIN
MSG
