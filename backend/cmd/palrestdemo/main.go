// palrestdemo 示範如何用 internal/palrest 操作 Palworld 官方 REST API。
//
// 用法：
//
//	go run ./cmd/palrestdemo -host 127.0.0.1 -port 8212 -pass <ADMIN_PASSWORD>
//
// 或用環境變數 PAL_HOST / PAL_PORT / PAL_PASS。
//
// 預設只做「唯讀」查詢（info/metrics/players/settings）。
// 加上旗標才會執行有副作用的動作：
//
//	-announce "Hello_world"     # 廣播訊息
//	-save                       # 存檔
//	-kick steam_0000... -reason 搗亂
//	-shutdown 30 -message 維護中 # 30 秒後關閉
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strconv"
	"time"

	"palscheduler/internal/palrest"
)

func main() {
	var (
		host     = flag.String("host", env("PAL_HOST", "127.0.0.1"), "REST API 主機")
		port     = flag.Int("port", envInt("PAL_PORT", 8212), "REST API 埠")
		pass     = flag.String("pass", env("PAL_PASS", ""), "AdminPassword")
		announce = flag.String("announce", "", "廣播一則訊息")
		save     = flag.Bool("save", false, "存檔世界")
		kick     = flag.String("kick", "", "踢出玩家的 userId")
		reason   = flag.String("reason", "kicked", "kick/ban 顯示原因")
		shutdown = flag.Int("shutdown", -1, "N 秒後關閉伺服器（-1 表示不執行）")
		message  = flag.String("message", "server shutting down", "shutdown 顯示訊息")
	)
	flag.Parse()

	if *pass == "" {
		fmt.Fprintln(os.Stderr, "錯誤：請用 -pass 或環境變數 PAL_PASS 提供 AdminPassword")
		os.Exit(1)
	}

	c := palrest.NewClient(*host, *port, *pass, palrest.WithTimeout(8*time.Second))
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// ---- 唯讀查詢 ----
	if info, err := c.Info(ctx); err != nil {
		fatal("Info", err)
	} else {
		fmt.Printf("伺服器：%s  版本：%s  世界：%s\n", info.ServerName, info.Version, info.WorldGUID)
	}

	if m, err := c.Metrics(ctx); err != nil {
		fatal("Metrics", err)
	} else {
		fmt.Printf("指標：FPS=%d 線上=%d/%d 運行=%ds 據點=%d 第%d天\n",
			m.ServerFPS, m.CurrentPlayerNum, m.MaxPlayerNum, m.UptimeSeconds, m.BaseCampNum, m.Days)
	}

	if players, err := c.Players(ctx); err != nil {
		fatal("Players", err)
	} else {
		fmt.Printf("線上玩家 %d 位：\n", len(players))
		for _, p := range players {
			fmt.Printf("  - %s (Lv.%d, userId=%s, ping=%.0f, 建築=%d)\n",
				p.Name, p.Level, p.UserID, p.Ping, p.BuildingCount)
		}
	}

	// ---- 有副作用的動作（依旗標）----
	if *announce != "" {
		must("Announce", c.Announce(ctx, *announce))
		fmt.Println("已廣播。")
	}
	if *save {
		must("Save", c.Save(ctx))
		fmt.Println("已存檔。")
	}
	if *kick != "" {
		must("Kick", c.Kick(ctx, *kick, *reason))
		fmt.Println("已踢出。")
	}
	if *shutdown >= 0 {
		must("Shutdown", c.Shutdown(ctx, *shutdown, *message))
		fmt.Printf("已排定 %d 秒後關閉。\n", *shutdown)
	}
}

func fatal(op string, err error) {
	fmt.Fprintf(os.Stderr, "%s 失敗：%v\n", op, err)
	os.Exit(1)
}

func must(op string, err error) {
	if err != nil {
		fatal(op, err)
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
