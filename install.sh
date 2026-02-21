#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/volume1/Docker/MagicMirror"
CONFIG_FILE="${ROOT_DIR}/mounts/config/config.js"
COMPOSE_FILE="${ROOT_DIR}/run/docker-compose.yml"

echo "=== MagicMirror install ==="
echo "ROOT_DIR: ${ROOT_DIR}"
echo "CONFIG_FILE: ${CONFIG_FILE}"
echo "COMPOSE_FILE: ${COMPOSE_FILE}"

if [ -f "$COMPOSE_FILE" ]; then
  MEDIA_ROOT="$(awk -F: '/FamilyMedia/ { print $1; exit }' "$COMPOSE_FILE" | xargs)"
  VVT_STOP_NAME="$(awk -F: '/VVT_STOP_NAME/ { print $2; exit }' "$COMPOSE_FILE" | xargs)"
  echo "MEDIA_ROOT (photos): ${MEDIA_ROOT:-unknown}"
  echo "VVT_STOP_NAME: ${VVT_STOP_NAME:-unknown}"
fi

if [ -f "$CONFIG_FILE" ]; then
  CAL_URL="$(awk -F\" '/calendar.google.com\\/calendar\\/ical/ { print $2; exit }' "$CONFIG_FILE")"
  WEATHER_LAT="$(awk -F: '/lat: / { print $2; exit }' "$CONFIG_FILE" | tr -d ' ,')"
  WEATHER_LON="$(awk -F: '/lon: / { print $2; exit }' "$CONFIG_FILE" | tr -d ' ,')"
  VVT_STOP_ID="$(awk -F\" '/stopId:/ { print $2; exit }' "$CONFIG_FILE")"
  echo "Calendar URL: ${CAL_URL:-unknown}"
  echo "Weather coords: ${WEATHER_LAT:-?}, ${WEATHER_LON:-?}"
  echo "VVT_STOP_ID: ${VVT_STOP_ID:-none}"
fi

cd "$ROOT_DIR"
git pull

docker build -t mmm-pl-backend:0.1 "$ROOT_DIR/mounts/modules/MMM-PL-Flashbacks/backend"

cd "$ROOT_DIR/run"
docker compose up -d --force-recreate mmm-pl-backend magicmirror

