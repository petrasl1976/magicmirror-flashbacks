## MagicMirror (custom + backend)

### Quick install (AsusTor)
Copy `install.sh` to AsusTor (via SSH) and run it. It will:
- clone or update this repo into `/volume1/Docker/MagicMirror`
- build the backend image
- start both containers (`mmm-pl-backend` and `magicmirror`)

Example:
```
scp install.sh user@asustor:/tmp/install.sh
ssh user@asustor "bash /tmp/install.sh"
```

### Required configuration
Before running, update these values on AsusTor:
- **Media path**: `/volume1/FamilyMedia` (photos location)
  - `run/docker-compose.yml` → volume mapping
- **Bus stop** (VVT): stop name and/or stop ID
  - `run/docker-compose.yml` → `VVT_STOP_NAME`
  - `mounts/config/config.js` → `stopName`, `stopId`
- **Weather coordinates**
  - `mounts/config/config.js` → `lat`, `lon`
  - `run/docker-compose.yml` → `WEATHER_LAT`, `WEATHER_LON`
- **Calendar URL**
  - `mounts/config/config.js` → calendar `url`

Once those are set, re-run `install.sh`.
