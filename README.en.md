[繁體中文](README.md) | **English** | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

# 🐏 Palworld Player Lookup (all-in-one server suite)

**Double-click one file and you get a complete Palworld dedicated server**, plus a lookup website your players can open in any browser:

![Dashboard](docs/screenshots/01-dashboard.png)

- 🖥️ Palworld dedicated server (community Docker image)
- ⏰ Automatic open/close scheduler (time windows, shutdown countdown broadcasts, crash auto-restart)
- 🌐 Player lookup website: Dashboard / Players / Pals / Traits / **Breeding** / Paldex / Bosses / Rankings / Online activity
- 🥚 Breeding tools: full coverage of 299 breedable pals × 44,851 recipes, interactive **breeding tree** and **shortest-path** planner, player-view owned/missing markers
- 🌍 Website UI in 4 languages (Traditional Chinese / Simplified Chinese / English / Japanese)

📖 **[Full user manual with screenshots](docs/manual.html)** · screenshot gallery: [docs/screenshots/](docs/screenshots/)

---

## 🚀 Start a server in 3 steps (no commands required)

1. **Install Docker**
   - Windows: install and start [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   - Linux: `curl -fsSL https://get.docker.com | sh`
2. **Download this project**: green `Code` button → `Download ZIP` → extract (or `git clone`)
3. **Launch**
   - Windows: double-click **`start.bat`**
   - Linux/macOS: `./start.sh`

The first launch **generates all configuration and two random passwords automatically** (shown in the console — write them down), then pulls the images and starts all four services:

| Service | Address |
|---|---|
| Lookup website | `http://localhost` (or `http://your-host-ip`) |
| Game connection | `your-host-ip:8211` (UDP) + the join password shown on first run |

## 🕹️ Day-to-day operation (just double-click)

| Action | Windows | Linux/macOS |
|---|---|---|
| Start everything | `start.bat` | `./start.sh` |
| Restart (apply new settings) | `restart.bat` | `./restart.sh` |
| Stop everything | `stop.bat` | `./stop.sh` |
| Status / logs | `status.bat` | `./status.sh` |

Prefer a single executable? Install [Go](https://go.dev/dl/), then `cd tools/launcher && go build -o ../../palserver.exe .` — double-click `palserver.exe` for a numbered menu (start / restart / stop / status / rebuild website).

## 🎛️ Tune the server by editing ONE file: `.env`

**Every** Palworld parameter (name, player cap, passwords, EXP/capture/damage rates, egg hatching time, PvP… ~50 options) lives in `.env` at the project root. Each option is documented in English in [`.example.env`](.example.env). Save your changes, then double-click `restart.bat`:

```env
SERVER_NAME=My Palworld Server
PLAYERS=32
EXP_RATE=1.0          # experience multiplier
PAL_CAPTURE_RATE=1.0  # capture rate multiplier
PAL_EGG_DEFAULT_HATCHING_TIME=72.0  # hours to hatch
```

> `.env` is git-ignored — your passwords never leave your machine. Anything you omit falls back to a sane default.

## 🚚 Painless migration: bring your existing save

The whole system reads exactly one location: `backend/palworld-data/`. Copy your world folder in and the website instantly shows YOUR server's players, pals and rankings:

```text
backend/palworld-data/Pal/Saved/SaveGames/0/<YourWorldGUID>/   ← drop the whole folder here
    ├── Level.sav        (world save)
    ├── LevelMeta.sav
    └── Players/*.sav    (one per player)
```

1. Stop both servers first (`stop.bat`)
2. Source location: Windows dedicated server `PalServer\Pal\Saved\SaveGames\0\<GUID>`; same layout on Linux/Docker
3. Copy the whole `<GUID>` folder into the path above
4. Linux hosts: `sudo chown -R 1000:1000 backend/palworld-data`
5. `start.bat`, then hit 🔄 in the website header

> ⚠️ Never edit `PalWorldSettings.ini` directly — it is regenerated from `.env` on every boot.

## ⏰ Schedule & broadcasts: `backend/config.json`

Open/close time windows and shutdown countdown messages live here (auto-generated on first run; see `config.example.json`):

| Field | Meaning |
|---|---|
| `schedule.windows` | Opening hours, e.g. `{ "days": ["Sat","Sun"], "open": "10:00", "close": "03:00" }` (crosses midnight automatically; 24/7 = `00:00`–`24:00` all week) |
| `hooks.onClose.announce` | Pre-shutdown broadcasts: `{ "at": 600, "message": "Closing in 10 minutes" }` — edit just this array |
| `api.token` | API password used by the website backend (randomly generated) |

Apply with `docker compose restart scheduler` (or simply `restart.bat`).

## 🔄 Refresh breeding data after game updates (optional)

```bash
cd frontend
node scripts/fetch-palcalc-breeding.mjs   # recipes
node scripts/fetch-pal-meta.mjs           # elements / paldex no. / rarity
pnpm build && cd .. && docker compose up -d --no-deps --build panel
```

## ❓ FAQ

| Problem | Fix |
|---|---|
| Website shows no players | Save not in the right folder (see migration), or the server never ran; then hit 🔄 |
| Scheduler didn't open the server | Check `TZ` in `.env` and `schedule.windows` in `config.json`; `status.bat` for logs |
| Forgot the passwords | They're in plain text in `.env`; change and `restart.bat` |
| Port already in use | Change the left side of the port mappings (80 / 8211 / 9000) in the compose files |

## License & credits

- Breeding recipes: [tylercamp/palcalc](https://github.com/tylercamp/palcalc) (MIT)
- Elements / rarity: [oMaN-Rod/palworld-save-pal](https://github.com/oMaN-Rod/palworld-save-pal)
- Server image: [thijsvanloef/palworld-server-docker](https://github.com/thijsvanloef/palworld-server-docker)
- Other data sources: `frontend/packages/web/public/game-data/CREDITS.md`
