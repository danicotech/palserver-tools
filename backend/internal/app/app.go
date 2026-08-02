// Package app 組裝各元件並管理生命週期。
package app

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"palscheduler/internal/api"
	"palscheduler/internal/palsave"
	"palscheduler/internal/scheduler"
)

// App 是頂層應用程式，持有排程器與 API 伺服器。
type App struct {
	sch *scheduler.Scheduler
	api *api.Server
}

// New 由 Wire 注入建立。
func New(sch *scheduler.Scheduler, apiServer *api.Server) *App {
	return &App{sch: sch, api: apiServer}
}

// Run 啟動排程器與 API，並在收到中止訊號時優雅關閉。
func (a *App) Run() error {
	stop := make(chan struct{})

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sig
		log.Println("收到中止訊號，正在停止...")
		close(stop)
	}()

	// SteamCMD 版：存檔解析由我們自己帶起來，畫面上就不必再多一個視窗。
	// Docker 版 palsave 是獨立容器，NewFromEnv 會回 nil，這段自動跳過。
	if sup := palsave.NewFromEnv(); sup != nil {
		go sup.Run(stop)
	}

	if url := os.Getenv("PANEL_URL"); url != "" && os.Getenv("PANEL_OPEN_BROWSER") == "1" {
		go openBrowserWhenReady(url, stop)
	}

	apiErr := make(chan error, 1)
	go func() { apiErr <- a.api.Run(stop) }()

	// 排程器在主 goroutine 執行，直到 stop 關閉。
	a.sch.Run(stop)

	if err := <-apiErr; err != nil {
		return err
	}
	log.Println("已停止。")
	return nil
}
