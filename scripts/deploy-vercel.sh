#!/usr/bin/env bash
# Le site public se déploie avec scripts/deploy-manual-vercel.sh.
exec "$(cd "$(dirname "$0")" && pwd)/deploy-manual-vercel.sh"
