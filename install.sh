#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/volume1/Docker/MagicMirror"

cd "$ROOT_DIR"
git pull

docker build -t mm-flashbacks:0.1 "$ROOT_DIR/mounts/modules/MMM-Flashbacks/backend"

cd "$ROOT_DIR/run"
docker compose up -d --force-recreate flashbacks-backend
docker restart mm

