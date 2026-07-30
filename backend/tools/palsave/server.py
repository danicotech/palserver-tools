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
import threading
import http.server
import socketserver
import urllib.parse

from extract_pals import load_gvas, extract, load_maps  # 匯入時會套用相容性 monkeypatch

SAVE_ROOT = os.environ.get("SAVE_ROOT", "/palworld")
PORT = int(os.environ.get("PORT", "8213"))
HERE = os.path.dirname(os.path.abspath(__file__))
MAPS = load_maps(HERE)

_cache = {"path": None, "mtime": None, "data": None}
_lock = threading.Lock()


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
        data = extract(load_gvas(path), MAPS)
        data["source"] = os.path.relpath(path, SAVE_ROOT)
        _cache.update(path=path, mtime=mtime, data=data)
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
