package main

import (
	"fmt"
	"log"
	"os"

	// 內嵌 Go 的時區資料庫：即使容器沒安裝 tzdata / 未設 TZ，
	// time.LoadLocation("Asia/Taipei") 仍可解析，排程時區不會退回 UTC。
	_ "time/tzdata"

	"palscheduler/internal/cli"
)

func main() {
	args := os.Args[1:]

	// 無參數 → 顯示說明（當作 CLI 工具使用時較友善）
	if len(args) == 0 {
		cli.PrintHelp()
		return
	}

	// serve：以常駐服務執行（排程器 + API）。容器與 bat 一鍵啟動都用這個。
	if args[0] == "serve" {
		runDaemon()
		return
	}

	// 其餘一律交給 CLI 客戶端處理（含 --help）。
	if err := cli.Run(args); err != nil {
		fmt.Fprintln(os.Stderr, "錯誤:", err)
		os.Exit(1)
	}
}

// runDaemon 啟動排程器與 API 伺服器，並阻塞直到收到終止訊號。
func runDaemon() {
	log.SetFlags(log.LstdFlags)
	application, err := InitializeApp()
	if err != nil {
		log.Fatalf("初始化失敗: %v", err)
	}
	if err := application.Run(); err != nil {
		log.Fatalf("執行錯誤: %v", err)
	}
}
