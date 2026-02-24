#!/bin/bash
set -euo pipefail

SERVICE_NAME="magic-mirror-client.service"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}"
DISPLAY_SCRIPT="/usr/local/bin/magic-mirror-client.sh"
ENV_FILE="/etc/magic-mirror-client.env"
DEFAULT_URL="http://192.168.88.48:8080/"
OLD_SERVICE_NAME="fridge-kiosk-display.service"
OLD_SERVICE_PATH="/etc/systemd/system/${OLD_SERVICE_NAME}"

if [ "${EUID}" -ne 0 ]; then
  echo "Please run as root (sudo)."
  exit 1
fi

EXISTING_URL=""
if [ -f "${ENV_FILE}" ]; then
  EXISTING_URL="$(grep -E '^KIOSK_URL=' "${ENV_FILE}" | sed -E 's/^KIOSK_URL="?([^"]*)"?$/\1/' || true)"
fi

PROMPT_URL="Enter kiosk URL to open (e.g. ${DEFAULT_URL})"
if [ -n "${EXISTING_URL}" ]; then
  read -r -p "${PROMPT_URL} [${EXISTING_URL}]: " KIOSK_URL
  KIOSK_URL="${KIOSK_URL:-${EXISTING_URL}}"
else
  read -r -p "${PROMPT_URL} [${DEFAULT_URL}]: " KIOSK_URL
  KIOSK_URL="${KIOSK_URL:-${DEFAULT_URL}}"
fi

if [ -z "${KIOSK_URL}" ]; then
  echo "Kiosk URL is required."
  exit 1
fi

KIOSK_USER="${SUDO_USER:-$(id -un)}"
if ! id "${KIOSK_USER}" >/dev/null 2>&1; then
  echo "User ${KIOSK_USER} not found."
  exit 1
fi

echo "Installing packages..."
apt-get update -y
apt-get install -y curl dbus-user-session cage

if apt-cache show chromium >/dev/null 2>&1; then
  apt-get install -y chromium
  CHROMIUM_BIN="chromium"
elif apt-cache show chromium-browser >/dev/null 2>&1; then
  apt-get install -y chromium-browser
  CHROMIUM_BIN="chromium-browser"
else
  echo "Chromium package not found (chromium or chromium-browser)."
  exit 1
fi

echo "Configuring user groups..."
usermod -a -G video,render,input,seat,tty "${KIOSK_USER}"

echo "Writing environment file: ${ENV_FILE}"
cat > "${ENV_FILE}" <<EOF
KIOSK_URL="${KIOSK_URL}"
CHROMIUM_BIN="${CHROMIUM_BIN}"
WAIT_TIMEOUT_SEC="180"
EOF

echo "Writing display script: ${DISPLAY_SCRIPT}"
cat > "${DISPLAY_SCRIPT}" <<'EOF'
#!/bin/bash
set -euo pipefail

# shellcheck disable=SC1091
. /etc/magic-mirror-client.env

export XDG_RUNTIME_DIR=/tmp/xdg-runtime-dir
export WAYLAND_DISPLAY=wayland-0
export DISPLAY=:0
export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"

export WLR_DRM_NO_ATOMIC=1
export WLR_RENDERER=pixman
export WLR_BACKENDS=drm

mkdir -p "${XDG_RUNTIME_DIR}"
chmod 700 "${XDG_RUNTIME_DIR}"

if [ ! -e "${XDG_RUNTIME_DIR}/bus" ]; then
  dbus-daemon --session --address="${DBUS_SESSION_BUS_ADDRESS}" --nofork --nopidfile --syslog-only &
  sleep 1
fi

echo "Starting kiosk display..."

cage -d -- "${CHROMIUM_BIN}" \
  --kiosk \
  --disable-gpu \
  --disable-software-rasterizer \
  --disable-dev-shm-usage \
  --no-sandbox \
  --disable-dbus \
  --incognito \
  --disable-extensions \
  --disable-plugins \
  --disable-popup-blocking \
  --disable-notifications \
  "${KIOSK_URL}" &

wait
EOF
chmod +x "${DISPLAY_SCRIPT}"

if [ -f "${OLD_SERVICE_PATH}" ]; then
  systemctl disable --now "${OLD_SERVICE_NAME}" >/dev/null 2>&1 || true
  rm -f "${OLD_SERVICE_PATH}"
fi

echo "Writing systemd service: ${SERVICE_PATH}"
cat > "${SERVICE_PATH}" <<EOF
[Unit]
Description=Magic Mirror Client Service
After=network.target

[Service]
User=${KIOSK_USER}
SupplementaryGroups=video render input seat tty
RuntimeDirectory=user/%U
RuntimeDirectoryMode=0700
Environment="XDG_RUNTIME_DIR=/tmp/xdg-runtime-dir"
Environment="WAYLAND_DISPLAY=wayland-0"
Environment="QT_QPA_PLATFORM=wayland"
Environment="GDK_BACKEND=wayland"
Environment="WLR_DRM_NO_ATOMIC=1"
Environment="WLR_RENDERER=pixman"
Environment="WLR_BACKENDS=drm"
Environment="DISPLAY=:0"
Environment="DBUS_SESSION_BUS_ADDRESS=unix:path=%t/user/%U/bus"
EnvironmentFile=${ENV_FILE}
ExecStartPre=/bin/bash -c "echo 'waiting for backend'; end=\$((SECONDS+\${WAIT_TIMEOUT_SEC:-180})); until curl -s \"\${KIOSK_URL}\" > /dev/null 2>&1; do if [ \$SECONDS -ge \$end ]; then echo 'backend wait timed out'; exit 1; fi; sleep 2; done"
ExecStartPre=/bin/mkdir -p /tmp/xdg-runtime-dir
ExecStartPre=/bin/chmod 700 /tmp/xdg-runtime-dir
ExecStartPre=/bin/chown ${KIOSK_USER}:${KIOSK_USER} /tmp/xdg-runtime-dir
ExecStart=${DISPLAY_SCRIPT}
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "Done. Service status:"
systemctl status "${SERVICE_NAME}" --no-pager
