# palsave sidecar：解析 Palworld 存檔取得玩家帕魯資料，供 scheduler 內網呼叫。
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY extract_pals.py server.py pal_names.json skill_names.json passive_names.json pal_static.json ./

ENV SAVE_ROOT=/palworld \
    PORT=8213
EXPOSE 8213

# 健康檢查（供 compose 顯示狀態）
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8213/healthz')" || exit 1

CMD ["python", "server.py"]
