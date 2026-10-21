#!/usr/bin/env bash
# Site public StoreForAll. Marchands, commandes et produits restent sur Hetzner.
# Aucun secret dans ce script : les variables sont déjà dans le projet Vercel.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ORG_ID="team_P9enNZ1FJ7AEBLYERRXSbg8z"
TARGET_NAME="storeforall"
TARGET_ID="prj_0VNvfpUOKhpnMqwnJ8t9Ha5dexPZ"

if command -v vercel >/dev/null 2>&1; then
  VERCEL=(vercel)
else
  VERCEL=(npx --yes vercel)
fi
[[ -n "${VERCEL_TOKEN:-}" ]] && VERCEL+=(-t "$VERCEL_TOKEN")
[[ -n "${VERCEL_SCOPE:-}" ]] && VERCEL+=(--scope "$VERCEL_SCOPE")

mkdir -p .vercel
printf '{"projectId":"%s","orgId":"%s","projectName":"%s"}\n' \
  "$TARGET_ID" "$ORG_ID" "$TARGET_NAME" > .vercel/project.json

echo "→ Projet lié : $TARGET_NAME ($TARGET_ID)"
echo "→ Déploiement production du site…"
"${VERCEL[@]}" deploy --prod --yes

echo "OK : https://storeforall.vercel.app/"
