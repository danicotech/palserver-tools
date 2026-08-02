package app

import (
	"log"
	"net/http"
	"os/exec"
	"runtime"
	"time"
)

// openBrowserWhenReady 等 API 真的開始聽了再打開查詢網站。
//
// 這件事本來是啟動腳本做的，但腳本沒辦法「等服務起來」——
// 太早開會看到連線失敗的畫面，用 timeout 硬等又得多開一個閃一下的黑視窗。
// 由排程器自己來最準：它知道自己什麼時候聽好了。
// 只在 PANEL_OPEN_BROWSER=1 時啟用（SteamCMD 版的 start-all 會設），
// Docker 版與伺服器環境不會莫名其妙跳出瀏覽器。
func openBrowserWhenReady(url string, stop <-chan struct{}) {
	client := &http.Client{Timeout: 2 * time.Second}
	for i := 0; i < 120; i++ { // 最多等 60 秒（第一次要載入存檔，會慢）
		select {
		case <-stop:
			return
		case <-time.After(500 * time.Millisecond):
		}
		resp, err := client.Get(url + "/healthz")
		if err != nil {
			continue
		}
		resp.Body.Close()
		if err := openURL(url); err != nil {
			log.Printf("開啟瀏覽器失敗:%v(請自己開 %s)", err, url)
		}
		return
	}
	log.Printf("服務遲遲沒有就緒，沒有自動開啟瀏覽器(可自己開 %s)", url)
}

func openURL(url string) error {
	switch runtime.GOOS {
	case "windows":
		// 用 rundll32 而不是 cmd /c start —— 後者會閃一個主控台視窗出來，
		// 正好是這次要消滅的東西。
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}
