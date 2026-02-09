#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/volume1/Docker/MagicMirror"

cd "$ROOT_DIR"
git pull

docker build -t mmm-pl-backend:0.1 "$ROOT_DIR/mounts/modules/MMM-PL-Flashbacks/backend"

cd "$ROOT_DIR/run"
docker compose up -d --force-recreate mmm-pl-backend
docker restart mm

