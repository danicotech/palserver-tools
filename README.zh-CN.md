[繁體中文](README.md) | [English](README.en.md) | **简体中文** | [日本語](README.ja.md)

# 🐏 帕鲁玩家查询工具网(Palworld 服务器全家桶)

**双击一个文件就能开好整套 Palworld 服务器**,并附带一个玩家用浏览器就能看的查询网站:

![总览](docs/screenshots/01-dashboard.png)

- 🖥️ Palworld 专用服务器(Docker 社区镜像)
- ⏰ 自动排程开关服(时段开关、关服倒数广播、崩溃自动重启)
- 🌐 玩家查询网站:总览 / 玩家 / 帕鲁 / 词条 / **配种表** / 图鉴 / 首领 / 排行榜 / 上线分析
- 🥚 配种表:299 只 × 44,851 条配方全覆盖,交互式**配种树**与**最短路径**规划、玩家视角标记已拥有/缺
- 🌍 网站四语界面(繁中/简中/英/日)

📖 **[完整使用手册(全功能图文教学)](docs/manual.html)** · 截图目录:[docs/screenshots/](docs/screenshots/)

---

## 🚀 三步骤开服(不用会任何命令)

1. **安装 Docker**
   - Windows:安装并打开 [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   - Linux:`curl -fsSL https://get.docker.com | sh`
2. **下载本项目**:点 GitHub 绿色 `Code` 按钮 → `Download ZIP` → 解压(或 `git clone`)
3. **启动**
   - Windows:双击 **`start.bat`**
   - Linux/macOS:`./start.sh`

第一次启动会**自动生成所有配置与两组随机密码**(显示在窗口里,请记下来),然后自动下载镜像并开好四个服务:

| 服务 | 地址 |
|---|---|
| 玩家查询网站 | `http://localhost`(或 `http://主机IP`) |
| 游戏连接 | `主机IP:8211`(UDP)+ 窗口显示的进服密码 |

## 🕹️ 日常操作(双击即可)

| 动作 | Windows | Linux/macOS |
|---|---|---|
| 启动全部 | `start.bat` | `./start.sh` |
| 重启(套用新设置) | `restart.bat` | `./restart.sh` |
| 停止全部 | `stop.bat` | `./stop.sh` |
| 看状态/日志 | `status.bat` | `./status.sh` |

偏好单一可执行文件?装好 [Go](https://go.dev/dl/) 后 `cd tools/launcher && go build -o ../../palserver.exe .`,双击 `palserver.exe` 会有数字菜单(启动/重启/停止/状态/只更新网站)。

## 🎛️ 调整服务器参数:只改一个文件 `.env`

**所有** Palworld 参数(名称、人数、密码、经验/捕捉/伤害倍率、孵蛋时间、PvP…约 50 项)都集中在项目根目录的 `.env`,每一项在 [`.example.env`](.example.env) 都有英文注释说明。改完保存 → 双击 `restart.bat` 即生效:

```env
SERVER_NAME=My Palworld Server
PLAYERS=32
EXP_RATE=1.0          # 经验倍率
PAL_CAPTURE_RATE=1.0  # 捕捉率
PAL_EGG_DEFAULT_HATCHING_TIME=72.0  # 孵蛋小时数
```

> `.env` 不会进 git,你的密码只存在自己电脑。没写的项目自动用默认值。

## 🚚 无痛搬家:把你原本服务器的存档换进来

系统只读一个位置:`backend/palworld-data/`。把原服务器的世界文件夹整个复制进来,网站的所有数据就变成你的服务器:

```text
backend/palworld-data/Pal/Saved/SaveGames/0/<你的世界GUID>/   ← 整个文件夹放这里
    ├── Level.sav        (世界主存档)
    ├── LevelMeta.sav
    └── Players/*.sav    (每位玩家)
```

1. 两边服务器都先停止(`stop.bat`)
2. 原存档位置:Windows 专服 `PalServer\Pal\Saved\SaveGames\0\<GUID>`;Linux/Docker 同层级
3. 复制整个 `<GUID>` 文件夹到上面路径
4. Linux 主机:`sudo chown -R 1000:1000 backend/palworld-data`
5. `start.bat` → 网站右上 🔄 重新加载

> ⚠️ 不要直接改 `PalWorldSettings.ini` —— 每次开机会由 `.env` 重新生成。

## ⏰ 排程与广播:`backend/config.json`

开服时段表与关服倒数广播都在这(首次启动自动生成;`config.example.json` 为模板):

| 字段 | 说明 |
|---|---|
| `schedule.windows` | 开服时段。例 `{ "days": ["Sat","Sun"], "open": "10:00", "close": "03:00" }`(跨午夜自动处理;24 小时开 = `00:00`~`24:00` 全周) |
| `hooks.onClose.announce` | 关服前广播:`{ "at": 600, "message": "10 分钟后关服" }`,想改时间/文案只改这个数组 |
| `api.token` | 网站后台调用排程器的密码(自动随机生成) |

改完:`docker compose restart scheduler`(或直接 `restart.bat`)。

## 🔄 游戏更新后刷新配种数据(可选)

```bash
cd frontend
node scripts/fetch-palcalc-breeding.mjs   # 配方
node scripts/fetch-pal-meta.mjs           # 属性/图鉴编号/稀有度
pnpm build && cd .. && docker compose up -d --no-deps --build panel
```

## ❓ 常见问题

| 问题 | 解法 |
|---|---|
| 网站没有玩家数据 | 存档没放对位置(见搬家章节),或服务器还没开过;放好后按网站 🔄 |
| 排程没开服 | 检查 `.env` 的 `TZ` 与 `config.json` 的 `schedule.windows`;`status.bat` 看日志 |
| 忘记密码 | 打开根目录 `.env` 就看得到;改完 `restart.bat` |
| 端口被占用 | 80/8211/9000 改 compose 的 ports 左半边 |

## 授权与致谢

- 配种配方:[tylercamp/palcalc](https://github.com/tylercamp/palcalc)(MIT)
- 属性/稀有度:[oMaN-Rod/palworld-save-pal](https://github.com/oMaN-Rod/palworld-save-pal)
- 服务器镜像:[thijsvanloef/palworld-server-docker](https://github.com/thijsvanloef/palworld-server-docker)
- 其余数据来源见 `frontend/packages/web/public/game-data/CREDITS.md`
