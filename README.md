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
Edit that file to customize media folder, calendar URL, bus stop, and weather
coordinates. On every run, it re-applies values from `install.env` and
rebuilds/restarts containers.

If you change values later, you can either re-run `install.sh`, or just rebuild:
```
docker build -t mmm-pl-backend:0.1 "/volume1/Docker/MagicMirror/mounts/modules/MMM-PL-Flashbacks/backend"
cd "/volume1/Docker/MagicMirror/run"
docker compose up -d --force-recreate mmm-pl-backend magicmirror
```
