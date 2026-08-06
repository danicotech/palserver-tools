#!/usr/bin/env python3
"""palsave sidecar：以 HTTP 提供「解析存檔取得玩家帕魯資料」。

由 palscheduler 透過 compose 內網呼叫（scheduler 的 /api/pals 會代理到這裡）。
Go 無法直接解析 GVAS 存檔，故用這個 Python 服務處理。

端點：
    GET /healthz               健康檢查
    GET /players               玩家清單摘要（含 UUID，不含每隻帕魯）
    GET /pals                  全部玩家的帕魯（結構同 extract_pals 的輸出）
    GET /pals?uuid=<UUID|名稱>  只回符合的玩家（存檔內 UUID 或名稱，部分比對）
    GET /source                存檔來源資訊（根目錄、目前世界、偵測到的世界清單）
    POST /source               切換存檔根目錄，body: {"root": "<絕對路徑>"}
    POST /analyze              解析「上傳上來的」存檔位元組（body 即整份 Level.sav）

環境變數：
    SAVE_ROOT   存檔根目錄（掛入的 palworld-data），預設 /palworld
    PORT        監聽埠，預設 8213

解析結果會依 Level.sav 的 mtime 快取，存檔沒變就不重解。
"""
import os
import sys
import json
import time
import threading
import http.server
import socketserver
import urllib.parse

# 先把「本檔所在目錄」放進 sys.path,再 import 同目錄的 extract_pals。
# 一般 Python 會自動這麼做,但 Windows 的「可攜版」(embeddable) 因為帶了 ._pth,
# 既不會加入腳本目錄、也會忽略 PYTHONPATH —— 少了這行就是
# ModuleNotFoundError: No module named 'extract_pals',整個服務起不來。
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract_pals import unknown_struct_summary, load_gvas, extract, load_maps, extract_guilds  # 匯入時會套用相容性 monkeypatch

# SAVE_ROOT 可在執行期由 POST /source 切換(排程器的 /api/palsave/source 會轉過來),
# 所以包成 list 當可變容器 —— 換路徑不必重開整個服務。
SAVE_ROOT = os.environ.get("SAVE_ROOT", "/palworld")
PORT = int(os.environ.get("PORT", "8213"))
GUILDS_TTL = int(os.environ.get("GUILDS_TTL", "120"))  # 公會/據點重解最短間隔(秒)
HERE = os.path.dirname(os.path.abspath(__file__))
MAPS = load_maps(HERE)

_cache = {"path": None, "mtime": None, "data": None}
_lock = threading.Lock()

# 公會/據點走慢路徑(要解析到存檔尾段的 GroupSaveDataMap,約 20 秒),
# 獨立快取 + 背景更新:請求永遠拿目前快取,過期就丟背景執行緒重解,不阻塞 /pals。
_guilds = {"mtime": None, "at": 0.0, "list": [], "running": False}
_guilds_lock = threading.Lock()


def _refresh_guilds(path, mtime):
    try:
        # 與 get_data() 互斥:extract_guilds 會暫時改動模組層 _STOP_AT,
        # 不可與快路徑解析交錯執行。
        with _lock:
            gl = extract_guilds(path)
        with _guilds_lock:
            _guilds.update(mtime=mtime, at=time.time(), list=gl, running=False)
        print(f"[palsave] guilds 更新:{len(gl)} 個公會", flush=True)
    except Exception as e:
        with _guilds_lock:
            _guilds.update(at=time.time(), running=False)  # 失敗也記時間,避免連環重試
        print(f"[palsave] guilds 解析失敗:{e}", flush=True)


def get_guilds(path, mtime):
    """回目前快取的公會清單;存檔變了且超過 TTL 就在背景重解(首次為空 list)。"""
    with _guilds_lock:
        stale = _guilds["mtime"] != mtime and time.time() - _guilds["at"] >= GUILDS_TTL
        if stale and not _guilds["running"]:
            _guilds["running"] = True
            threading.Thread(target=_refresh_guilds, args=(path, mtime), daemon=True).start()
        return _guilds["list"]


def list_worlds(root=None):
    """列出這個根目錄底下所有含 Level.sav 的世界資料夾(含大小與最後存檔時間)。
    供面板顯示「你指到的路徑裡有哪些世界」,設定路徑時才不用盲猜。"""
    root = root or SAVE_ROOT
    base = os.path.join(root, "Pal", "Saved", "SaveGames", "0")
    out = []
    if os.path.isdir(base):
        for d in sorted(os.listdir(base)):
            p = os.path.join(base, d, "Level.sav")
            if os.path.exists(p):
                st = os.stat(p)
                out.append({"id": d, "size": st.st_size, "mtime": int(st.st_mtime)})
    return out


def find_level_sav(root=None):
    """找出目前世界的 Level.sav：優先用 GameUserSettings 的 DedicatedServerName，
    否則挑最近修改的一份。"""
    SAVE_ROOT_LOCAL = root or SAVE_ROOT
    base = os.path.join(SAVE_ROOT_LOCAL, "Pal", "Saved", "SaveGames", "0")
    # Docker 版是 LinuxServer，SteamCMD 版(Windows)是 WindowsServer —— 兩個都要找，
    # 只寫死 LinuxServer 的話 Windows 會退回「挑最新的 Level.sav」，多開一個世界就會選錯。
    cfg = os.path.join(SAVE_ROOT_LOCAL, "Pal", "Saved", "Config")
    wid = None
    for host in ("LinuxServer", "WindowsServer"):
        try:
            with open(os.path.join(cfg, host, "GameUserSettings.ini"),
                      encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if line.startswith("DedicatedServerName="):
                        wid = line.split("=", 1)[1].strip()
                        break
        except OSError:
            continue
        if wid:
            break
    if wid:
        p = os.path.join(base, wid, "Level.sav")
        if os.path.exists(p):
            return p
    cands = []
    if os.path.isdir(base):
        for d in os.listdir(base):
            p = os.path.join(base, d, "Level.sav")
            if os.path.exists(p):
                cands.append(p)
    if not cands:
        raise FileNotFoundError(f"在 {base} 找不到任何 Level.sav")
    return max(cands, key=os.path.getmtime)


def get_data():
    """回傳解析結果，依存檔 mtime 快取。"""
    try:
        path = find_level_sav()
    except FileNotFoundError:
        # 伺服器剛裝好、還沒跑到第一次自動存檔(預設 30 秒)時完全正常。
        # 回空結果讓網站顯示「還沒有玩家」，而不是丟 500 讓人以為後端掛了。
        return {"total_pals": 0, "orphan_pals": 0, "players": [],
                "guilds": [], "source": "", "pending": True}
    mtime = os.path.getmtime(path)
    with _lock:
        if _cache["path"] == path and _cache["mtime"] == mtime:
            return _cache["data"]
        t0 = time.time()
        data = extract(load_gvas(path), MAPS)
        data["source"] = os.path.relpath(path, SAVE_ROOT)
        _cache.update(path=path, mtime=mtime, data=data)
        note = unknown_struct_summary()
        print(f"[palsave] 解析完成:{len(data.get('players', []))} 位玩家、"
              f"{data.get('total_pals', 0)} 隻帕魯,耗時 {time.time() - t0:.1f}s"
              + (f"({note})" if note else ""), flush=True)
        return data


# 上傳上限。存檔通常幾十 MB;給到 512 MB 足夠涵蓋玩很久的大世界,
# 又不至於讓人一次丟一個 GB 級檔案把記憶體吃光。
MAX_UPLOAD = int(os.environ.get("PALSAVE_MAX_UPLOAD", str(512 * 1024 * 1024)))


def source_info():
    """目前的存檔來源:根目錄、選中的世界、以及這個根目錄底下有哪些世界。"""
    info = {"root": SAVE_ROOT, "exists": os.path.isdir(SAVE_ROOT),
            "worlds": list_worlds(), "current": "", "mtime": 0}
    try:
        path = find_level_sav()
        info["current"] = os.path.relpath(path, SAVE_ROOT)
        info["mtime"] = int(os.path.getmtime(path))
    except Exception:
        pass  # 還沒有任何存檔是正常狀態(伺服器剛裝好)
    return info


def filter_player(data, q):
    ql = q.lower()
    players = [p for p in data["players"]
               if ql in p["name"].lower() or ql in p["uid"].lower()]
    return {**data, "players": players}


class Handler(http.server.BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/healthz":
            return self._json(200, {"ok": True})
        if parsed.path == "/source":
            return self._json(200, source_info())
        if parsed.path in ("/pals", "/players"):
            try:
                data = get_data()
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
            # 公會/據點:非同步慢路徑,失敗或未就緒時為空 list,不影響主資料
            try:
                if _cache["path"] is None:
                    raise FileNotFoundError  # 還沒有存檔可解，直接走下面的空 list
                guilds = get_guilds(_cache["path"], _cache["mtime"])
                uid2name = {p["uid"]: p["name"] for p in data["players"]}
                data = {**data, "guilds": [
                    {**gd, "players": [{"uid": u, "name": uid2name.get(u, "")}
                                       for u in gd["member_uids"]]}
                    for gd in guilds
                ]}
            except Exception:
                data = {**data, "guilds": []}
            qs = urllib.parse.parse_qs(parsed.query)
            uuid = (qs.get("uuid") or qs.get("q") or [""])[0]  # q 為相容舊參數
            if uuid:
                data = filter_player(data, uuid)
            if parsed.path == "/players":
                # 只回玩家摘要（不含每隻帕魯），方便先取得 UID 與人數
                data = {**data, "players": [{k: v for k, v in p.items() if k != "pals"}
                                            for p in data["players"]]}
            return self._json(200, data)
        return self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/source":
            return self._set_source()
        if parsed.path == "/analyze":
            return self._analyze()
        return self._json(404, {"ok": False, "error": "not found"})

    def _read_body(self, limit):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            raise ValueError("沒有收到內容")
        if n > limit:
            raise ValueError(f"檔案太大({n // 1048576} MB),上限 {limit // 1048576} MB")
        buf = bytearray()
        while len(buf) < n:
            chunk = self.rfile.read(min(1 << 20, n - len(buf)))
            if not chunk:
                break
            buf.extend(chunk)
        return bytes(buf)

    def _set_source(self):
        """切換存檔根目錄。只接受「看起來真的是存檔目錄」的路徑 ——
        這個端點能讀任意路徑,限制成必須含 Pal/Saved/SaveGames 可擋掉大部分誤用。"""
        global SAVE_ROOT
        try:
            body = json.loads(self._read_body(64 * 1024) or b"{}")
        except Exception as e:
            return self._json(400, {"ok": False, "error": f"body 需為 JSON:{e}"})
        root = (body.get("root") or "").strip()
        if not root:
            return self._json(400, {"ok": False, "error": "需要 root(存檔根目錄的絕對路徑)"})
        root = os.path.abspath(os.path.expanduser(root))
        if not os.path.isdir(root):
            return self._json(400, {"ok": False, "error": f"找不到資料夾:{root}"})
        if not os.path.isdir(os.path.join(root, "Pal", "Saved", "SaveGames")):
            return self._json(400, {"ok": False, "error":
                              "這個資料夾底下沒有 Pal/Saved/SaveGames,不像是存檔根目錄"})
        with _lock:
            SAVE_ROOT = root
            _cache.update(path=None, mtime=None, data=None)  # 換世界了,舊快取一律作廢
        with _guilds_lock:
            _guilds.update(mtime=None, at=0.0, list=[], running=False)
        print(f"[palsave] 存檔根目錄已切換:{root}", flush=True)
        return self._json(200, {"ok": True, **source_info()})

    def _analyze(self):
        """解析上傳上來的存檔。整份存檔只存在記憶體,不寫任何檔案 ——
        使用者是把自己的單機存檔丟上來看數據,不該在別人的機器上留下副本。"""
        try:
            blob = self._read_body(MAX_UPLOAD)
        except ValueError as e:
            return self._json(400, {"ok": False, "error": str(e)})
        t0 = time.time()
        try:
            # 與定時解析互斥:extract_guilds 會暫時改動模組層狀態,不可交錯執行
            with _lock:
                data = extract(load_gvas(blob), MAPS)
                try:
                    guilds = extract_guilds(blob)
                except Exception as e:
                    print(f"[palsave] 上傳存檔的公會解析失敗(不影響主資料):{e}", flush=True)
                    guilds = []
        except ValueError as e:
            return self._json(400, {"ok": False, "error": str(e)})
        except Exception as e:
            return self._json(500, {"ok": False, "error": f"解析失敗:{e}"})
        uid2name = {p["uid"]: p["name"] for p in data.get("players", [])}
        data = {**data, "source": "(上傳的存檔)", "uploaded": True, "guilds": [
            {**gd, "players": [{"uid": u, "name": uid2name.get(u, "")}
                               for u in gd["member_uids"]]}
            for gd in guilds
        ]}
        print(f"[palsave] 上傳存檔解析完成:{len(data.get('players', []))} 位玩家、"
              f"{data.get('total_pals', 0)} 隻帕魯,耗時 {time.time() - t0:.1f}s", flush=True)
        return self._json(200, data)

    def log_message(self, fmt, *args):
        pass  # 靜音預設存取日誌


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    print(f"[palsave] 監聽 :{PORT}，SAVE_ROOT={SAVE_ROOT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
