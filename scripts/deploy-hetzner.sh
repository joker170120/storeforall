#!/usr/bin/env bash
# Base StoreForAll sur Hetzner : données + ffmpeg / upload / HLS.
# Ne remplace pas le site public (Vercel) et ne touche pas aux autres conteneurs.
# Le volume des données (store.json) n'est pas écrasé.
set -euo pipefail

HOST="${HETZNER_HOST:-root@167.233.117.168}"
REMOTE_DIR="${HETZNER_DIR:-/opt/storeforall}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_OPTS=(-i "${HETZNER_SSH_KEY:-$HOME/.ssh/id_ed25519}" -o IdentitiesOnly=yes -o BatchMode=yes)
PUBLIC_URL="${PUBLIC_URL:-https://storeforall.vercel.app}"
DATA_URL="${DATA_URL:-https://storeforall.167.233.117.168.sslip.io}"

echo "→ Sync code vers ${HOST}:${REMOTE_DIR} (sans .env)…"
ssh "${SSH_OPTS[@]}" "$HOST" "mkdir -p ${REMOTE_DIR}"
rsync -az -e "ssh ${SSH_OPTS[*]}" \
  --exclude node_modules \
  --exclude .git \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude data \
  --exclude .vercel \
  "${ROOT}/" "${HOST}:${REMOTE_DIR}/"

echo "→ Variables sur le serveur, hors Git…"
rsync -az -e "ssh ${SSH_OPTS[*]}" "${ROOT}/.env" "${HOST}:${REMOTE_DIR}/.env"
ssh "${SSH_OPTS[@]}" "$HOST" "python3 - << 'PY'
from pathlib import Path
import secrets
p = Path('${REMOTE_DIR}/.env')
text = p.read_text()
out = []
seen_secret = False
for line in text.splitlines():
    if line.startswith('PUBLIC_BASE_URL='):
        out.append('PUBLIC_BASE_URL=${PUBLIC_URL}')
    elif line.startswith('SESSION_SECRET='):
        val = line.split('=', 1)[1].strip() or secrets.token_hex(32)
        out.append('SESSION_SECRET=' + val)
        seen_secret = True
    elif line.startswith('NODE_ENV='):
        out.append('NODE_ENV=production')
    else:
        out.append(line)
if not seen_secret:
    out.append('SESSION_SECRET=' + secrets.token_hex(32))
p.write_text('\n'.join(out) + '\n')
p.chmod(0o600)
print('env-serveur-ok')
PY
cd ${REMOTE_DIR} && docker compose -f hetzner/docker-compose.prod.yml up -d --build"

echo "→ Santé de la base (pas du site)…"
sleep 4
curl -fsS --max-time 25 "${DATA_URL}/api/health" | grep -q '"storage":"hetzner"' \
  && echo "OK base ${DATA_URL} → site ${PUBLIC_URL}" \
  || echo "WARN: ${DATA_URL}/api/health"
