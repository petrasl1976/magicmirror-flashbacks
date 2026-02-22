#!/bin/sh
set -e

ROOT_DIR="/volume1/Docker/MagicMirror"
REPO_URL="git@github.com:petrasl1976/magicmirror-flashbacks.git"
CONFIG_FILE="${ROOT_DIR}/mounts/config/config.js"
COMPOSE_FILE="${ROOT_DIR}/run/docker-compose.yml"
CONFIG_ENV="${ROOT_DIR}/install.env"

if [ ! -d "$ROOT_DIR/.git" ]; then
  mkdir -p "$(dirname "$ROOT_DIR")"
  git clone "$REPO_URL" "$ROOT_DIR" || {
    echo "ERROR: git clone failed"
    exit 1
  }
fi

cd "$ROOT_DIR"
git pull

if [ ! -f "$CONFIG_ENV" ]; then
  cat > "$CONFIG_ENV" <<EOF
MEDIA_ROOT="/volume1/FamilyMedia"
CAL_URL="https://calendar.google.com/calendar/ical/REPLACE_ME/basic.ics"
STOP_NAME="Vaduvos st."
STOP_ID=""
WEATHER_LAT="54.6401508"
WEATHER_LON="25.2059223"
EOF
fi

# shellcheck disable=SC1090
. "$CONFIG_ENV"

esc_sed() { printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'; }

media_esc="$(esc_sed "$MEDIA_ROOT")"
stop_esc="$(esc_sed "$STOP_NAME")"
sed -i -E "s|/volume1/[^:]+:/media:ro|${media_esc}:/media:ro|g" "$COMPOSE_FILE"
sed -i -E "s|VVT_STOP_NAME:.*|VVT_STOP_NAME: ${stop_esc}|g" "$COMPOSE_FILE"
sed -i -E "s|WEATHER_LAT:.*|WEATHER_LAT: \"${WEATHER_LAT}\"|g" "$COMPOSE_FILE"
sed -i -E "s|WEATHER_LON:.*|WEATHER_LON: \"${WEATHER_LON}\"|g" "$COMPOSE_FILE"

cal_esc="$(esc_sed "$CAL_URL")"
stop_name_esc="$(esc_sed "$STOP_NAME")"
stop_id_esc="$(esc_sed "$STOP_ID")"
sed -i -E "s|stopName:[[:space:]]*\"[^\"]*\"|stopName: \"${stop_name_esc}\"|g" "$CONFIG_FILE"
sed -i -E "s|stopId:[[:space:]]*\"[^\"]*\"|stopId: \"${stop_id_esc}\"|g" "$CONFIG_FILE"
sed -i -E "s|lat:[[:space:]]*[0-9.]+|lat: ${WEATHER_LAT}|g" "$CONFIG_FILE"
sed -i -E "s|lon:[[:space:]]*[0-9.]+|lon: ${WEATHER_LON}|g" "$CONFIG_FILE"
if [ -n "$cal_esc" ]; then
  sed -i -E "0,/url:[[:space:]]*\"https?:\\/\\/[^\\\"]+\"/s//url: \"${cal_esc}\"/" "$CONFIG_FILE"
fi

echo "=== Effective configuration: $CONFIG_ENV ==="
cat "$CONFIG_ENV"

sudo docker build -t mmm-pl-backend:0.1 "$ROOT_DIR/mounts/modules/MMM-PL-Flashbacks/backend"
cd "$ROOT_DIR/run"
sudo docker compose up -d --force-recreate mmm-pl-backend magicmirror

