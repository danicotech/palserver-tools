// Package cli 提供命令列客戶端：以子指令操作正在運行的 scheduler HTTP API。
// 全部使用 Go 標準函式庫（flag / net/http），無第三方相依。
package cli

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// clientConfig 只擷取 CLI 需要的 api 區塊（寬鬆解析，不做完整驗證）。
type clientConfig struct {
	API struct {
		Listen string `json:"listen"`
		Token  string `json:"token"`
	} `json:"api"`
}

type client struct {
	base  string
	token string
	http  *http.Client
}

// Run 解析並執行一個 CLI 子指令。args 為 os.Args[1:]。
func Run(args []string) error {
	if len(args) == 0 {
		PrintHelp()
		return nil
	}
	cmd := args[0]
	rest := args[1:]

	switch cmd {
	case "-h", "--help", "help":
		PrintHelp()
		return nil
	}

	// 每個子指令都支援的通用旗標
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	host := fs.String("host", envOr("PAL_HOST", ""), "API 位址，例如 127.0.0.1:9000（預設讀 config.json）")
	token := fs.String("token", envOr("PAL_TOKEN", ""), "API token（預設讀 config.json 的 api.token）")
	cfgPath := fs.String("config", envOr("PAL_CONFIG", "config.json"), "config.json 路徑")
	// 子指令專屬旗標
	countdown := fs.Int("countdown", 0, "stop：關服倒數秒數")
	seconds := fs.Int("seconds", 60, "shutdown：倒數秒數")
	message := fs.String("message", "", "shutdown：訊息（空白用底線）")
	to := fs.String("to", "me", "teleport 方向：me 或 player")

	fs.SetOutput(os.Stderr)
	if err := fs.Parse(rest); err != nil {
		return err
	}
	positional := fs.Args()

	c, err := newClient(*host, *token, *cfgPath)
	if err != nil {
		return err
	}

	switch cmd {
	case "status":
		return c.call("GET", "/api/status", nil)
	case "start":
		return c.call("POST", "/api/start", nil)
	case "auto":
		return c.call("POST", "/api/auto", nil)
	case "stop":
		q := url.Values{}
		if *countdown > 0 {
			q.Set("countdown", strconv.Itoa(*countdown))
		}
		return c.call("POST", "/api/stop", q)
	case "save":
		return c.call("POST", "/api/save", nil)
	case "players":
		return c.call("GET", "/api/players", nil)
	case "info":
		return c.call("GET", "/api/info", nil)
	case "broadcast":
		if len(positional) == 0 {
			return fmt.Errorf("用法: broadcast <訊息>（空白用底線 _）")
		}
		q := url.Values{}
		q.Set("msg", strings.Join(positional, "_"))
		return c.call("POST", "/api/broadcast", q)
	case "kick", "ban", "unban":
		if len(positional) == 0 {
			return fmt.Errorf("用法: %s <SteamID>", cmd)
		}
		q := url.Values{}
		q.Set("steamid", positional[0])
		return c.call("POST", "/api/"+cmd, q)
	case "shutdown":
		q := url.Values{}
		q.Set("seconds", strconv.Itoa(*seconds))
		if *message != "" {
			q.Set("message", *message)
		}
		return c.call("POST", "/api/shutdown", q)
	case "doexit":
		return c.call("POST", "/api/doexit", nil)
	case "teleport":
		if len(positional) == 0 {
			return fmt.Errorf("用法: teleport <SteamID> [--to me|player]")
		}
		q := url.Values{}
		q.Set("steamid", positional[0])
		if strings.EqualFold(*to, "player") {
			q.Set("mode", "toplayer")
		} else {
			q.Set("mode", "tome")
		}
		return c.call("POST", "/api/teleport", q)
	case "spectate":
		return c.call("POST", "/api/spectate", nil)
	case "adminpassword":
		if len(positional) == 0 {
			return fmt.Errorf("用法: adminpassword <密碼>")
		}
		q := url.Values{}
		q.Set("password", positional[0])
		return c.call("POST", "/api/adminpassword", q)
	case "rcon":
		if len(positional) == 0 {
			return fmt.Errorf("用法: rcon <指令...>，例如 rcon ShowPlayers")
		}
		q := url.Values{}
		q.Set("command", strings.Join(positional, " "))
		return c.call("POST", "/api/rcon", q)
	default:
		return fmt.Errorf("未知指令 %q，用 --help 查看可用指令", cmd)
	}
}

func newClient(host, token, cfgPath string) (*client, error) {
	// 從 config.json 補上未由旗標指定的值
	if host == "" || token == "" {
		if cc, err := loadClientConfig(cfgPath); err == nil {
			if token == "" {
				token = cc.API.Token
			}
			if host == "" && cc.API.Listen != "" {
				host = normalizeHost(cc.API.Listen)
			}
		}
	}
	if host == "" {
		host = "127.0.0.1:9000"
	}
	if token == "" {
		return nil, fmt.Errorf("找不到 token：請用 --token、環境變數 PAL_TOKEN、或確認 config.json 的 api.token")
	}
	return &client{
		base:  "http://" + host,
		token: token,
		http:  &http.Client{Timeout: 15 * time.Second},
	}, nil
}

func (c *client) call(method, path string, q url.Values) error {
	u := c.base + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequest(method, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Auth-Token", c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("連線 %s 失敗：%w（scheduler 有在執行嗎？可先 docker compose ps）", c.base, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("HTTP %d\n%s\n", resp.StatusCode, prettyJSON(body))
	if resp.StatusCode >= 400 {
		os.Exit(1)
	}
	return nil
}

func loadClientConfig(path string) (*clientConfig, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cc clientConfig
	if err := json.Unmarshal(raw, &cc); err != nil {
		return nil, err
	}
	return &cc, nil
}

// normalizeHost 把 0.0.0.0:9000 轉成可連線的 127.0.0.1:9000。
func normalizeHost(listen string) string {
	if strings.HasPrefix(listen, "0.0.0.0:") {
		return "127.0.0.1:" + strings.TrimPrefix(listen, "0.0.0.0:")
	}
	if strings.HasPrefix(listen, ":") {
		return "127.0.0.1" + listen
	}
	return listen
}

func prettyJSON(b []byte) string {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return string(b)
	}
	out, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return string(b)
	}
	return string(out)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// PrintHelp 顯示 --help 內容。
func PrintHelp() {
	fmt.Print(helpText)
}

const helpText = `palscheduler — Palworld 伺服器排程 / RCON 控制工具

用法:
  palscheduler <指令> [參數] [旗標]
  palscheduler serve                     以常駐服務執行（排程器 + API，容器用）

排程控制:
  status                                 查詢目前狀態（模式 / 是否執行 / 下一時段）
  start                                  強制開啟（忽略排程，直到 auto）
  stop   [--countdown N]                 強制關閉（倒數 N 秒後關；跑 onManualStop）
  auto                                   恢復自動排程

RCON / 伺服器（對應 Palworld 官方 13 個指令）:
  info                                   伺服器資訊（Info）
  players                                在線玩家（ShowPlayers）
  save                                   存檔（Save）
  broadcast <訊息>                       全服廣播（Broadcast，多字以底線相連）
  kick   <SteamID>                       踢出玩家（KickPlayer）
  ban    <SteamID>                       封鎖玩家（BanPlayer）
  unban  <SteamID>                       解除封鎖（UnBanPlayer）
  shutdown [--seconds N] [--message M]   倒數關閉（Shutdown）
  doexit                                 立即關閉（DoExit）
  teleport <SteamID> [--to me|player]    傳送（TeleportToMe/ToPlayer，需遊戲內管理員）
  spectate                               觀戰模式（ToggleSpectate，需遊戲內管理員）
  adminpassword <密碼>                   取得管理權限（AdminPassword，RCON 通常不需）
  rcon   <指令...>                       送出任意 RCON 指令，例如 rcon ShowPlayers

  註：teleport / spectate / adminpassword 需要遊戲內管理員情境，透過 RCON 多半無效，
      仍保留為通道。其餘 9 個指令可正常使用。

通用旗標:
  --host   127.0.0.1:9000                API 位址（預設讀 config.json；亦可用 PAL_HOST）
  --token  <token>                       API token（預設讀 config.json；亦可用 PAL_TOKEN）
  --config config.json                   設定檔路徑（亦可用 PAL_CONFIG）

範例:
  palscheduler status
  palscheduler broadcast Server_restart_in_5_min
  palscheduler stop --countdown 30
  palscheduler kick 76561198000000000
  palscheduler rcon ShowPlayers
  palscheduler --host 1.2.3.4:9000 --token abc123 status
`
