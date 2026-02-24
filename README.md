## MagicMirror (custom + backend)

### Quick install (AsusTor)
SSH to AsusTor and run:
```
curl -fsSL https://raw.githubusercontent.com/petrasl1976/magicmirror-flashbacks/main/install.sh | sh
```

This will:
- clone or update this repo into `/volume1/Docker/MagicMirror`
- build the backend image
- start both containers (`mmm-pl-backend` and `magicmirror`)

On first run, the installer creates `install.env` with defaults.
Edit that file to set the media folder, calendar URL, bus stop (from VVT stop list), and coordinates for the weather forecast. On every run, the installer re-applies `install.env` and rebuilds/restarts the containers.

If you change values later, you can either re-run `install.sh`, or just rebuild:
```
sudo docker build -t mmm-pl-backend:0.1 "/volume1/Docker/MagicMirror/mounts/modules/MMM-PL-Flashbacks/backend"
cd "/volume1/Docker/MagicMirror/run"
sudo docker compose up -d --force-recreate mmm-pl-backend magicmirror
```

## Client (kiosk)
The kiosk installer sets up a minimal kiosk service on the Raspberry Pi (Cage + Chromium) that boots straight into the MagicMirror URL.
Needs: Raspberry Pi with a display connected (HDMI), network access to the server, and a Debian/Ubuntu-based OS with `apt`.
After reboot, the `magic-mirror-client.service` starts automatically and launches `/usr/local/bin/magic-mirror-client.sh`.
The kiosk settings live in `/etc/magic-mirror-client.env`.

To set up the kiosk, run:
```
curl -fsSL https://raw.githubusercontent.com/petrasl1976/magicmirror-flashbacks/main/install-rpi-kiosk.sh | sh
```
