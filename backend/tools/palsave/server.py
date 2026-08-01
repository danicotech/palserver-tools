#!/usr/bin/env python3
"""palsave sidecar：以 HTTP 提供「解析存檔取得玩家帕魯資料」。

由 palscheduler 透過 compose 內網呼叫（scheduler 的 /api/pals 會代理到這裡）。
Go 無法直接解析 GVAS 存檔，故用這個 Python 服務處理。

端點：
    GET /healthz               健康檢查
    GET /players               玩家清單摘要（含 UUID，不含每隻帕魯）
    GET /pals                  全部玩家的帕魯（結構同 extract_pals 的輸出）
    GET /pals?uuid=<UUID|名稱>  只回符合的玩家（存檔內 UUID 或名稱，部分比對）

環境變數：
    SAVE_ROOT   存檔根目錄（掛入的 palworld-data），預設 /palworld
    PORT        監聽埠，預設 8213

解析結果會依 Level.sav 的 mtime 快取，存檔沒變就不重解。
"""
import os
import json
import time
import threading
import http.server
import socketserver
import urllib.parse

from extract_pals import unknown_struct_summary, load_gvas, extract, load_maps, extract_guilds  # 匯入時會套用相容性 monkeypatch

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


def find_level_sav():
    """找出目前世界的 Level.sav：優先用 GameUserSettings 的 DedicatedServerName，
    否則挑最近修改的一份。"""
    base = os.path.join(SAVE_ROOT, "Pal", "Saved", "SaveGames", "0")
    gus = os.path.join(SAVE_ROOT, "Pal", "Saved", "Config", "LinuxServer", "GameUserSettings.ini")
    wid = None
    try:
        with open(gus, encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("DedicatedServerName="):
                    wid = line.split("=", 1)[1].strip()
                    break
    except OSError:
        pass
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
    path = find_level_sav()
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
        if parsed.path in ("/pals", "/players"):
            try:
                data = get_data()
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
            # 公會/據點:非同步慢路徑,失敗或未就緒時為空 list,不影響主資料
            try:
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

    def log_message(self, fmt, *args):
        pass  # 靜音預設存取日誌


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    print(f"[palsave] 監聽 :{PORT}，SAVE_ROOT={SAVE_ROOT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
