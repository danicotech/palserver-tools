# RWD 自我驗測流程 (rwd-audit)

面板(玩家查詢)的響應式自動巡檢。對 **7 種真實裝置寬度**(320 / 375 / 390 / 412 / 768 / 1024 / 1280)走訪**每一個分頁**,程式化檢查並全頁截圖。

## 檢查項目
- **整頁橫向捲動**(body 不該左右滑)
- **元素比視窗寬**
- **內容被裁切且看不到**(overflow:hidden 且超寬;已排除刻意的 `truncate` 省略號)
- **文字 < 11px**(不可讀)
- **觸控目標 < 40px**(僅記錄,不計失敗)

通過時 exit 0,有問題時 exit 1(可接進 CI)。

## 安裝(第一次)
```bash
cd packages/web/rwd-audit
npm install          # 會自動下載 Chromium(postinstall)
```

## 每次編譯後執行
```bash
# 1) 先在 packages/web 編譯
pnpm --filter @palserver/web build
# 2) 跑巡檢(服務 dist → 巡檢 → 收掉 preview)
cd packages/web/rwd-audit && npm run audit
```
或一鍵(先 build 再巡檢):
```bash
cd packages/web/rwd-audit && npm run audit:build
```

## 產出
- 終端摘要(逐 裝置×分頁 的問題)
- `audit-report.json`(每個 offender 的 tag/class/尺寸)
- `shots/<裝置>-<分頁>.png`(全頁截圖,供肉眼複審)

## 只跑單一裝置
```bash
PROFILE=iphone-se npm run audit
```

> 註:主管理端 App(InstanceDetail 等)由 palscheduler Go 後端服務,需後端才會渲染,故不在此自動流程內;其 RWD(含手機漢堡分頁)另以 mock 隔離測試驗證。
