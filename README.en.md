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

1. **Install Docker** ([what is Docker?](#-about-docker))
   - Windows / macOS: install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and **start it** (the whale icon must be in the tray)
   - Linux: `curl -fsSL https://get.docker.com | sh`
2. **Download this project**: green `Code` button → `Download ZIP` → extract (or `git clone`)
3. **Launch**
   - Windows: double-click **`windows\start.bat`**
   - Linux/macOS: `bash linux/start.sh`

The first launch **generates all configuration and two random passwords automatically** (shown in the console — write them down), then pulls the images and starts all four services:

| Service | Address |
|---|---|
| Lookup website | `http://localhost` (or `http://your-host-ip`) |
| Game connection | `your-host-ip:8211` (UDP) + the join password shown on first run |

## 🐳 About Docker

All four services (game server, scheduler, save parser, web panel) run in Docker containers.
You **don't need to know Docker** — just install it, start it, and let `start.bat` / `start.sh` do the rest.

| Link | What it's for |
|---|---|
| [Docker home](https://www.docker.com/) | Project homepage |
| [**Docker Desktop download**](https://www.docker.com/products/docker-desktop/) | **Use this on Windows / macOS** — GUI included, just install and open |
| [Docker Engine install docs](https://docs.docker.com/engine/install/) | For Linux servers, or simply `curl -fsSL https://get.docker.com \| sh` |
| [Official getting-started guide](https://docs.docker.com/get-started/) | Optional background reading |

After installing, verify in a terminal (both must print a version):

```bash
docker --version
docker compose version
```

> **Common on Windows**: if `start.bat` says Docker isn't found, Docker Desktop is not running (or still
> starting) — wait until the tray whale stops animating and run it again. A first install may ask you to
> enable WSL 2 and reboot. If you'd rather not install Docker, see [SteamCMD edition](docs/SteamCMD版.md)
> (SteamCMD only, no web panel).

## 🕹️ Day-to-day operation (just double-click)

| Action | Windows | Linux/macOS |
|---|---|---|
| Start everything | `windows\start.bat` | `bash linux/start.sh` |
| Restart (apply new settings) | `windows\restart.bat` | `bash linux/restart.sh` |
| Stop everything | `windows\stop.bat` | `bash linux/stop.sh` |
| Status / logs | `windows\status.bat` | `bash linux/status.sh` |

Prefer a single executable? Install [Go](https://go.dev/dl/), then `cd tools/launcher && go build -o ../../palserver.exe .` — double-click `palserver.exe` for a numbered menu (start / restart / stop / status / rebuild website).

## 🎛️ Tune the server by editing ONE file: `.env`

**Every** Palworld parameter (name, player cap, passwords, EXP/capture/damage rates, egg hatching time, PvP… ~50 options) lives in `.env` at the project root. Each option is documented in English in [`.example.env`](.example.env). Save your changes, then double-click `windows\restart.bat`:

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

1. Stop both servers first (`windows\stop.bat`)
2. Source location: Windows dedicated server `PalServer\Pal\Saved\SaveGames\0\<GUID>`; same layout on Linux/Docker
3. Copy the whole `<GUID>` folder into the path above
4. Linux hosts: `sudo chown -R 1000:1000 backend/palworld-data`
5. `windows\start.bat`, then hit 🔄 in the website header

> ⚠️ Never edit `PalWorldSettings.ini` directly — it is regenerated from `.env` on every boot.

## ⏰ Schedule & broadcasts: `backend/config.json`

Open/close time windows and shutdown countdown messages live here (auto-generated on first run; see `config.example.json`):

| Field | Meaning |
|---|---|
| `schedule.windows` | Opening-hours table — **full rules in the subsection below** |
| `hooks.onClose.announce` | Pre-shutdown broadcasts: `{ "at": 600, "message": "Closing in 10 minutes" }` — edit just this array |
| `api.token` | API password used by the website backend (randomly generated) |

Apply with `docker compose restart scheduler` (or simply `windows\restart.bat`).

### `schedule.windows` in full (opening-hours table)

Each entry is one "open window"; you may list several:

```json
"windows": [
  { "label": "weekday-night", "days": ["Mon","Tue","Wed","Thu","Fri"], "open": "19:00", "close": "23:30" },
  { "label": "weekend",       "days": ["Sat","Sun"],                   "open": "10:00", "close": "03:00" }
]
```

| Field | Rules |
|---|---|
| `label` | Free-form note; no effect on behaviour |
| `days` | Which **opening days** the window applies to. Accepts `Mon`/`Tue`/`Wed`/`Thu`/`Fri`/`Sat`/`Sun` or full English names (`Monday`), case-insensitive |
| `open` / `close` | `"HH:MM"`, hours **0-23**, minutes 0-59 (⚠️ `24:00` is NOT valid) |

**Behaviour:**

- `close` ≤ `open` ⇒ closing time falls on the **next day**: `Sat 10:00 → 03:00` = opens Saturday 10 am, closes Sunday 3 am
- For windows crossing midnight, list only the opening day in `days`
- Multiple windows may overlap and a day may have several windows (morning + evening); the union applies
- **24/7 operation**: list all seven days with `"open": "00:00", "close": "00:00"` (close = open counts as next day, i.e. a full 24 h)
- To keep a day fully closed (e.g. Wednesday maintenance): simply omit `Wed` from every window's `days`
- All times use the `TZ` timezone from `.env`
- At `open` the scheduler runs `hooks.onOpen` (start container + welcome broadcast); at `close` it runs `hooks.onClose` (countdown broadcasts → save → shutdown) with the countdown **ending exactly at** the close time
- Manual override anytime: `POST /api/open`, `/api/close` act immediately; `/api/resume` hands control back to the schedule (all require `api.token`)

## 🔄 Refresh breeding data after game updates (optional)

```bash
cd frontend
node scripts/fetch-palcalc-breeding.mjs   # recipes
node scripts/fetch-pal-meta.mjs           # elements / paldex no. / rarity
pnpm build && cd .. && docker compose up -d --no-deps --build panel
```

## 🧱 No Docker? Use the SteamCMD edition

Machines that can't (or don't want to) run Docker can still host the game server with the scripts in
[`windows/native/`](windows/native). This is called the **SteamCMD edition** (formerly "native mode"):

1. Double-click `windows\native\install.bat` (auto-downloads SteamCMD + the server)
2. Double-click `windows\native\start.bat` (Linux: `bash linux/native/install.sh` then `bash linux/start.sh`)
3. Edit settings in `windows/native/server/Pal/Saved/Config/.../PalWorldSettings.ini` (never overwritten in the SteamCMD edition)

The SteamCMD edition only covers install/start/stop/update of the game server; the lookup website and the scheduler still require the Docker edition.
**Saves are fully interchangeable** - to upgrade later, move your world folder into `backend/palworld-data/` (see [docs/SteamCMD版.md](docs/SteamCMD版.md)).

### Where to download SteamCMD

**You normally don't need to** — `install.bat` / `install.sh` above fetches it automatically.
For a manual install:

| Link | What it's for |
|---|---|
| [SteamCMD docs (Valve Wiki)](https://developer.valvesoftware.com/wiki/SteamCMD) | Official docs, all platforms |
| [**Windows download (steamcmd.zip)**](https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip) | Extract anywhere, run `steamcmd.exe` |
| [Linux download (steamcmd_linux.tar.gz)](https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz) | Debian/Ubuntu also needs `sudo apt install -y curl lib32gcc-s1` |

The Palworld dedicated server App ID is **2394010**:

```bash
steamcmd +force_install_dir <path> +login anonymous +app_update 2394010 validate +quit
```

### Docker edition vs SteamCMD edition

| | 🐳 **Docker edition** (recommended) | 🧱 **SteamCMD edition** |
|---|---|---|
| Game server | ✅ | ✅ |
| Player lookup website | ✅ | ❌ |
| Auto schedule / shutdown broadcasts | ✅ | ❌ |
| Requires | Docker Desktop | SteamCMD only (scripts fetch it) |
| Where settings live | `.env` in the project root | `PalWorldSettings.ini` |
| Save location | `backend/palworld-data/` | `windows\native\server\` |

**Save formats are identical** — you can move between them any time (see [docs/SteamCMD版.md](docs/SteamCMD版.md)).

## 🌐 What the site gives you

Once it is up at <http://localhost>, everything is readable without logging in;
all of it comes straight from the server's save file.

| Tab | What it does |
|---|---|
| 📊 Overview | Players online, server FPS, in-game day, server-wide Paldeck completion, top players and most-owned Pals |
| 🧑 Players | **Player map** (everyone's last position plus guild bases, with coordinates), each player's level, stat points and full Pal list |
| 🐾 Pals | Search every Pal on the server, filter and sort by element, passive, work suitability and IVs |
| 🥚 Breeding | Shortest path, pair calculator, reverse lookup, breeding tree and **mutation breeding** (below) |
| 🏷️ Passives | Combined passive-skill search (AND/OR) to find who owns what |
| 📖 Paldeck | Server-wide and per-player completion, with the missing entries listed |
| 👑 Bosses | Tower and field boss progress |
| 🏆 Rankings | Leaderboards across several metrics |
| 🕐 Activity | When players are actually online |

The **🔄 refresh control** in the top right switches between manual and automatic
refresh (5s / 15s / 30s / 60s / 5m / 10m). Like Grafana, a refresh updates in
place: the page does not rebuild and map markers glide to their new positions.

## 🧬 Breeding: four ways to search

The four cards at the top of the Breeding tab:

- **🪜 Shortest path** — pick a Gen 0 and a target and get every generation as
  `A + B = C`. Choosing a target immediately lists which Pals can serve as Gen 0
  and how many generations each needs.
- **🥚 Pair calculator** — pick any two Pals to see the child; several pairs at once.
- **🔄 Reverse lookup** — every parent pair that yields a Pal, or what it can father.
- **🌳 Breeding tree** — expand node by node; Pals you do not own are greyed out.

### Breeding, mutation, or both

Inside the shortest-path view you can switch the source of each step:

| Mode | Meaning |
|---|---|
| **Breeding only** | Recipe table only — guaranteed to hatch |
| **Breeding + mutation** | Both are allowed, fewer generations preferred |
| **Mutation only** | Every step is a mutation egg |

The latter two add a **⚙ settings** button (cake, facility, Plesiosaur/Babysitter
boost). Each step is labelled as either a guaranteed recipe step or a mutation
with its odds, converted into **per-egg chance, average eggs and real time**.
A strategy toggle picks either the fewest generations or the best odds — the
latter minimises expected eggs and often wins by taking one extra generation.

> How the mutation odds are derived and verified: [Wiki: Mutation breeding](../../wiki/網站-變異配種).

### Passive filtering

In the shortest-path view, **🏷️ Passives** and **✨ Active skills** let you pick up
to four. The solver then searches your (or the whole server's) Pals for a route
that carries all of them onto the target. Parents may each carry only part of
them (1:3 or 2:2) — the child inherits the union.

## ❓ FAQ

| Problem | Fix |
|---|---|
| Website shows no players | Save not in the right folder (see migration), or the server never ran; then hit 🔄 |
| Scheduler didn't open the server | Check `TZ` in `.env` and `schedule.windows` in `config.json`; `windows\status.bat` for logs |
| Forgot the passwords | They're in plain text in `.env`; change and `windows\restart.bat` |
| Port already in use | Change the left side of the port mappings (80 / 8211 / 9000) in the compose files |

## License & credits

- Breeding recipes: [tylercamp/palcalc](https://github.com/tylercamp/palcalc) (MIT)
- Elements / rarity: [oMaN-Rod/palworld-save-pal](https://github.com/oMaN-Rod/palworld-save-pal)
- Server image: [thijsvanloef/palworld-server-docker](https://github.com/thijsvanloef/palworld-server-docker)
- Other data sources: `frontend/packages/web/public/game-data/CREDITS.md`
