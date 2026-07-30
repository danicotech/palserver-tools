[繁體中文](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md) | **日本語**

# 🐏 パルワールド プレイヤー検索ツール(サーバーオールインワン)

**ファイルをダブルクリックするだけで Palworld 専用サーバー一式が起動**。プレイヤーがブラウザで見られる検索サイト付き:

![ダッシュボード](docs/screenshots/01-dashboard.png)

- 🖥️ Palworld 専用サーバー(コミュニティ Docker イメージ)
- ⏰ 自動スケジューラー(営業時間で開閉、閉店カウントダウン放送、クラッシュ自動再起動)
- 🌐 プレイヤー検索サイト:ダッシュボード / プレイヤー / パル / パッシブ / **配合表** / 図鑑 / ボス / ランキング / オンライン分析
- 🥚 配合ツール:繁殖可能パル 299 種 × 44,851 レシピを完全網羅。インタラクティブな**配合ツリー**と**最短ルート**プランナー、プレイヤー視点の所持/未所持マーク
- 🌍 サイト UI は 4 言語対応(繁体字中国語 / 簡体字中国語 / 英語 / 日本語)

📖 **[完全マニュアル(全機能のスクリーンショット解説)](docs/manual.html)** · ギャラリー:[docs/screenshots/](docs/screenshots/)

---

## 🚀 3 ステップでサーバー開設(コマンド不要)

1. **Docker をインストール**
   - Windows:[Docker Desktop](https://www.docker.com/products/docker-desktop/) をインストールして起動
   - Linux:`curl -fsSL https://get.docker.com | sh`
2. **本プロジェクトをダウンロード**:GitHub の緑の `Code` ボタン → `Download ZIP` → 展開(または `git clone`)
3. **起動**
   - Windows:**`start.bat`** をダブルクリック
   - Linux/macOS:`./start.sh`

初回起動時に**全設定と 2 つのランダムパスワードを自動生成**(コンソールに表示されるのでメモしてください)。その後イメージを取得し 4 つのサービスを起動します:

| サービス | アドレス |
|---|---|
| 検索サイト | `http://localhost`(または `http://ホストIP`) |
| ゲーム接続 | `ホストIP:8211`(UDP)+ 初回表示された参加パスワード |

## 🕹️ 日常操作(ダブルクリックだけ)

| 操作 | Windows | Linux/macOS |
|---|---|---|
| すべて起動 | `start.bat` | `./start.sh` |
| 再起動(新設定を適用) | `restart.bat` | `./restart.sh` |
| すべて停止 | `stop.bat` | `./stop.sh` |
| 状態/ログ確認 | `status.bat` | `./status.sh` |

単一の実行ファイル派は [Go](https://go.dev/dl/) を入れて `cd tools/launcher && go build -o ../../palserver.exe .` — `palserver.exe` をダブルクリックすると番号メニュー(起動/再起動/停止/状態/サイトのみ更新)が出ます。

## 🎛️ サーバー設定はファイル 1 つ:`.env`

Palworld の**すべて**のパラメータ(サーバー名、人数、パスワード、経験値/捕獲/ダメージ倍率、孵化時間、PvP…約 50 項目)はプロジェクト直下の `.env` に集約。各項目は [`.example.env`](.example.env) に英語コメント付きで解説しています。保存後 `restart.bat` で反映:

```env
SERVER_NAME=My Palworld Server
PLAYERS=32
EXP_RATE=1.0          # 経験値倍率
PAL_CAPTURE_RATE=1.0  # 捕獲率倍率
PAL_EGG_DEFAULT_HATCHING_TIME=72.0  # 孵化時間(時間)
```

> `.env` は git 管理外 — パスワードが外部に出ることはありません。書かなかった項目は既定値になります。

## 🚚 かんたん引っ越し:既存サーバーのセーブを持ち込む

システムが読む場所は 1 つだけ:`backend/palworld-data/`。ワールドフォルダを丸ごとコピーすれば、サイトのデータはあなたのサーバーのものになります:

```text
backend/palworld-data/Pal/Saved/SaveGames/0/<ワールドGUID>/   ← フォルダごとここへ
    ├── Level.sav        (ワールド本体)
    ├── LevelMeta.sav
    └── Players/*.sav    (プレイヤーごと)
```

1. 両方のサーバーを停止(`stop.bat`)
2. 元の場所:Windows 専用サーバーは `PalServer\Pal\Saved\SaveGames\0\<GUID>`;Linux/Docker も同じ階層
3. `<GUID>` フォルダを丸ごと上記パスへコピー
4. Linux ホスト:`sudo chown -R 1000:1000 backend/palworld-data`
5. `start.bat` → サイト右上の 🔄 で再読込

> ⚠️ `PalWorldSettings.ini` を直接編集しないでください — 毎回 `.env` から再生成されます。

## ⏰ スケジュールと放送:`backend/config.json`

営業時間と閉店前カウントダウン放送はここ(初回起動で自動生成;テンプレは `config.example.json`):

| フィールド | 説明 |
|---|---|
| `schedule.windows` | 営業時間テーブル — **詳細ルールは下のサブセクション** |
| `hooks.onClose.announce` | 閉店前放送:`{ "at": 600, "message": "10 分後に閉店します" }` — この配列だけ編集すれば OK |
| `api.token` | サイトバックエンドが使う API パスワード(自動生成) |

反映:`docker compose restart scheduler`(または `restart.bat`)。

### `schedule.windows` 完全ガイド(営業時間テーブル)

1 エントリ = 1 つの「営業時間帯」。複数記述できます:

```json
"windows": [
  { "label": "weekday-night", "days": ["Mon","Tue","Wed","Thu","Fri"], "open": "19:00", "close": "23:30" },
  { "label": "weekend",       "days": ["Sat","Sun"],                   "open": "10:00", "close": "03:00" }
]
```

| フィールド | ルール |
|---|---|
| `label` | 自由なメモ。動作には影響しません |
| `days` | この時間帯を適用する「**開店当日**」。`Mon`/`Tue`/`Wed`/`Thu`/`Fri`/`Sat`/`Sun` または英語のフルネーム(`Monday`)、大文字小文字は不問 |
| `open` / `close` | `"HH:MM"`。時は **0–23**、分は 0–59(⚠️ `24:00` という表記は不可) |

**動作ルール:**

- `close` ≤ `open` ⇒ 閉店時刻は自動的に**翌日**扱い:`Sat 10:00 → 03:00` = 土曜 10 時開店、日曜 3 時閉店
- 日付をまたぐ場合、`days` には「開店する曜日」だけを書けば OK
- 複数の時間帯は重複可。同じ曜日に朝/夜の 2 枠も可(和集合として扱われます)
- **24 時間 365 日営業**:全 7 曜日を列挙し `"open": "00:00", "close": "00:00"`(close=open は翌日扱い=まる 24 時間)
- 特定曜日を完全休業(例:水曜メンテ):どの `days` にも `Wed` を入れないだけ
- 時刻はすべて `.env` の `TZ` タイムゾーンで計算
- `open` 時刻に `hooks.onOpen`(コンテナ起動+ようこそ放送)、`close` 時刻に `hooks.onClose`(カウントダウン放送→セーブ→停止)。カウントダウンの**終わり**が close 時刻に一致します
- 手動オーバーライド:`POST /api/open` / `/api/close` は即時実行、`/api/resume` でスケジュールに復帰(いずれも `api.token` が必要)

## 🔄 ゲームアップデート後の配合データ更新(任意)

```bash
cd frontend
node scripts/fetch-palcalc-breeding.mjs   # レシピ
node scripts/fetch-pal-meta.mjs           # 属性/図鑑番号/レア度
pnpm build && cd .. && docker compose up -d --no-deps --build panel
```

## 🧱 Docker なし?SteamCMD ネイティブモード

Docker を入れられない環境でも、[`native/`](native/README.md) のスクリプトでゲームサーバーを直接ホストできます:

1. `native\windows\install.bat` をダブルクリック(SteamCMD とサーバー本体を自動ダウンロード)
2. `native\windows\start.bat` で起動(Linux:`./install.sh` → `./start.sh`)
3. 設定は `native/server/Pal/Saved/Config/.../PalWorldSettings.ini` を編集(ネイティブモードでは上書きされません)

ネイティブモードはゲームサーバーのインストール/起動/停止/更新をカバー。検索サイトとスケジューラーには引き続き Docker が必要です。
**セーブは完全互換** — 後でフル構成に移行する場合はワールドフォルダを `backend/palworld-data/` に移すだけ(詳細は [native/README.md](native/README.md))。

## ❓ FAQ

| 症状 | 対処 |
|---|---|
| サイトにプレイヤーが出ない | セーブの置き場所違い(引っ越し章参照)、または未起動;配置後にサイトの 🔄 |
| スケジューラーが開店しない | `.env` の `TZ` と `config.json` の `schedule.windows` を確認;`status.bat` でログ |
| パスワードを忘れた | ルートの `.env` に平文で書いてあります;変更後 `restart.bat` |
| ポート競合 | compose の ports 左側(80 / 8211 / 9000)を変更 |

## ライセンスとクレジット

- 配合レシピ:[tylercamp/palcalc](https://github.com/tylercamp/palcalc)(MIT)
- 属性/レア度:[oMaN-Rod/palworld-save-pal](https://github.com/oMaN-Rod/palworld-save-pal)
- サーバーイメージ:[thijsvanloef/palworld-server-docker](https://github.com/thijsvanloef/palworld-server-docker)
- その他のデータソース:`frontend/packages/web/public/game-data/CREDITS.md`
