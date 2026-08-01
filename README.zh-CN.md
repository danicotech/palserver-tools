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
   - Windows:双击 **`windows\start.bat`**
   - Linux/macOS:`bash linux/start.sh`

第一次启动会**自动生成所有配置与两组随机密码**(显示在窗口里,请记下来),然后自动下载镜像并开好四个服务:

| 服务 | 地址 |
|---|---|
| 玩家查询网站 | `http://localhost`(或 `http://主机IP`) |
| 游戏连接 | `主机IP:8211`(UDP)+ 窗口显示的进服密码 |

## 🕹️ 日常操作(双击即可)

| 动作 | Windows | Linux/macOS |
|---|---|---|
| 启动全部 | `windows\start.bat` | `bash linux/start.sh` |
| 重启(套用新设置) | `windows\restart.bat` | `bash linux/restart.sh` |
| 停止全部 | `windows\stop.bat` | `bash linux/stop.sh` |
| 看状态/日志 | `windows\status.bat` | `bash linux/status.sh` |

偏好单一可执行文件?装好 [Go](https://go.dev/dl/) 后 `cd tools/launcher && go build -o ../../palserver.exe .`,双击 `palserver.exe` 会有数字菜单(启动/重启/停止/状态/只更新网站)。

## 🎛️ 调整服务器参数:只改一个文件 `.env`

**所有** Palworld 参数(名称、人数、密码、经验/捕捉/伤害倍率、孵蛋时间、PvP…约 50 项)都集中在项目根目录的 `.env`,每一项在 [`.example.env`](.example.env) 都有英文注释说明。改完保存 → 双击 `windows\restart.bat` 即生效:

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

1. 两边服务器都先停止(`windows\stop.bat`)
2. 原存档位置:Windows 专服 `PalServer\Pal\Saved\SaveGames\0\<GUID>`;Linux/Docker 同层级
3. 复制整个 `<GUID>` 文件夹到上面路径
4. Linux 主机:`sudo chown -R 1000:1000 backend/palworld-data`
5. `windows\start.bat` → 网站右上 🔄 重新加载

> ⚠️ 不要直接改 `PalWorldSettings.ini` —— 每次开机会由 `.env` 重新生成。

## ⏰ 排程与广播:`backend/config.json`

开服时段表与关服倒数广播都在这(首次启动自动生成;`config.example.json` 为模板):

| 字段 | 说明 |
|---|---|
| `schedule.windows` | 开服时段表 —— **完整规则见下方小节** |
| `hooks.onClose.announce` | 关服前广播:`{ "at": 600, "message": "10 分钟后关服" }`,想改时间/文案只改这个数组 |
| `api.token` | 网站后台调用排程器的密码(自动随机生成) |

改完:`docker compose restart scheduler`(或直接 `windows\restart.bat`)。

### `schedule.windows` 完整说明(开服时段表)

每一条就是一个「开放时段」,可以放多条:

```json
"windows": [
  { "label": "weekday-night", "days": ["Mon","Tue","Wed","Thu","Fri"], "open": "19:00", "close": "23:30" },
  { "label": "weekend",       "days": ["Sat","Sun"],                   "open": "10:00", "close": "03:00" }
]
```

| 字段 | 规则 |
|---|---|
| `label` | 自由命名,纯备注,不影响行为 |
| `days` | 该时段套用在哪些「**开服当天**」。可写 `Mon`/`Tue`/`Wed`/`Thu`/`Fri`/`Sat`/`Sun` 或英文全名(如 `Monday`),大小写不限 |
| `open` / `close` | `"HH:MM"`,小时 **0–23**、分 0–59(⚠️ 没有 `24:00` 这种写法) |

**行为规则:**

- `close` ≤ `open` ⇒ 关服时间自动落在**第二天**:`Sat 10:00 → 03:00` = 周六早 10 点开到周日凌晨 3 点
- 跨午夜时 `days` 只需列「开服那天」,不用把第二天也加进去
- 多条时段可重叠、同一天可拆早晚两段,效果等同取并集
- **24 小时全年无休**:七天全列 + `"open": "00:00", "close": "00:00"`(close=open 视为第二天,即整整 24 小时)
- 某天完全不开(例:周三维护):不要把 `Wed` 放进任何一条 `days` 即可
- 所有时间按 `.env` 的 `TZ` 时区计算
- 到 `open` 时间 → 执行 `hooks.onOpen`(启动容器+欢迎广播);到 `close` 时间 → 执行 `hooks.onClose`(倒数广播→存档→关机),倒数的**结尾**会对齐 close 时间
- 临时手动接管:`POST /api/open`、`/api/close` 立即开/关,`/api/resume` 交还给排程(均需 `api.token`)

## 🔄 游戏更新后刷新配种数据(可选)

```bash
cd frontend
node scripts/fetch-palcalc-breeding.mjs   # 配方
node scripts/fetch-pal-meta.mjs           # 属性/图鉴编号/稀有度
pnpm build && cd .. && docker compose up -d --no-deps --build panel
```

## 🧱 没有 Docker?SteamCMD 原生模式

不能装 Docker 的电脑,也能用 [`windows/native/`](windows/native) 文件夹的脚本直接开游戏服务器:

1. 双击 `native\windows\install.bat`(自动下载 SteamCMD + 服务器本体)
2. 双击 `windows\native\start.bat` 启动(Linux:`bash linux/native/install.sh` → `bash linux/start.sh`)
3. 设置改 `windows/native/server/Pal/Saved/Config/.../PalWorldSettings.ini`(原生模式不会被覆写)

原生模式涵盖游戏服务器的安装/启动/停止/更新;查询网站与自动排程仍需 Docker。
**两边存档完全互通**,之后想升级整套,把世界文件夹搬到 `backend/palworld-data/` 即可(详见 [docs/原生模式.md](docs/原生模式.md))。

## 🌐 查询网站有什么

开站后 <http://localhost>,不用登录就能看,所有资料直接读服务器存档。

| 分页 | 能做什么 |
|---|---|
| 📊 总览 | 在线人数、服务器 FPS、游戏天数、全服图鉴收服率、Top 玩家与最热门帕鲁 |
| 🧑 玩家查询 | **玩家地图**(全员最后位置 + 公会据点,附坐标)、每位玩家的等级/配点/全部帕鲁 |
| 🐾 帕鲁查询 | 全服帕鲁搜索,可依属性、词条、工作适性、个体值筛选排序 |
| 🥚 配种表 | 最短路径、配种计算、反查组合、配种树、**变异配种**(见下) |
| 🏷️ 词条查询 | 用被动技能复合查询(且/或),看谁身上有你要的词条 |
| 📖 图鉴收服率 | 全服与个人图鉴进度,缺哪几只一目了然 |
| 👑 首领进度 | 塔主与野外首领的击破状况 |
| 🏆 排行榜 | 各种维度的排名 |
| 🕐 上线分析 | 玩家上线时段分布 |

右上角的 **🔄 更新钮** 可切换手动或自动更新(5 秒 / 15 / 30 / 60 秒 / 5 分 / 10 分),
仿 Grafana 的做法:更新时画面不会重来,地图上的玩家会平滑滑到新位置。

## 🧬 配种表:四种找法

进「🥚 配种表」后,上排四张卡片各是一种找法:

- **🪜 最短路径** —— 选「初代」与「目标」,列出一路配到目标的每一代 `A ＋ B ＝ C`。
  选好目标就会直接告诉你**有哪些帕鲁能当初代**、各要几代。
- **🥚 配种计算** —— 随手选两只看生出什么,可同时开多组。
- **🔄 反查组合** —— 看某只帕鲁的全部父母组合,或它能当父母配出什么。
- **🌳 帕鲁配种树** —— 树状展开,点节点就往下长,缺的帕鲁显示灰阶。

### 直系 / 变异 三选一

「🪜 最短路径」里可以切换配种来源:

| 模式 | 说明 |
|---|---|
| **纯粹帕鲁配种** | 只走官方配方表,100% 生得出来 |
| **包含变异可能性** | 直系与突变都能用,优先代数少 |
| **纯粹变异配种** | 全程靠突变蛋 |

选了后两者会多出一颗 **⚙ 设定钮**(蛋糕、产蛋设施、梁叶龙/宝宝保姆加成),
每一步都会标示是「直系(必得)」还是「变异 + 几率」,并换算成
**每颗蛋几率 / 平均要几颗 / 大概要多久**。还能切「代数最少」或「成功率最高」——
后者会挑期望蛋数最少的走法,常常多绕一代反而更省。

> 变异几率的算法与验证方式写在 [Wiki:变异配种](../../wiki/網站-變異配種)。

### 词条筛选

在「🪜 最短路径」按 **🏷️ 词条** 或 **✨ 主动技能** 可复选(最多 4 个),
系统会用你(或全服)现有的帕鲁排列组合,找出把这些词条全部带到目标身上的路线。
父母各带一部分也可以(1:3、2:2 都行),子代会继承双亲词条的并集。

## ❓ 常见问题

| 问题 | 解法 |
|---|---|
| 网站没有玩家数据 | 存档没放对位置(见搬家章节),或服务器还没开过;放好后按网站 🔄 |
| 排程没开服 | 检查 `.env` 的 `TZ` 与 `config.json` 的 `schedule.windows`;`windows\status.bat` 看日志 |
| 忘记密码 | 打开根目录 `.env` 就看得到;改完 `windows\restart.bat` |
| 端口被占用 | 80/8211/9000 改 compose 的 ports 左半边 |

## 授权与致谢

- 配种配方:[tylercamp/palcalc](https://github.com/tylercamp/palcalc)(MIT)
- 属性/稀有度:[oMaN-Rod/palworld-save-pal](https://github.com/oMaN-Rod/palworld-save-pal)
- 服务器镜像:[thijsvanloef/palworld-server-docker](https://github.com/thijsvanloef/palworld-server-docker)
- 其余数据来源见 `frontend/packages/web/public/game-data/CREDITS.md`
