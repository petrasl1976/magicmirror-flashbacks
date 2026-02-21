#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/volume1/Docker/MagicMirror"
REPO_URL="git@github.com:petrasl1976/magicmirror-flashbacks.git"

if [ ! -d "$ROOT_DIR/.git" ]; then
  git clone "$REPO_URL" "$ROOT_DIR"
else
  (cd "$ROOT_DIR" && git pull)
fi

docker build -t mmm-pl-backend:0.1 "$ROOT_DIR/mounts/modules/MMM-PL-Flashbacks/backend"

cd "$ROOT_DIR/run"
docker compose up -d --force-recreate mmm-pl-backend magicmirror

