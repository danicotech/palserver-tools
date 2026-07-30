// Package api 提供 Gin HTTP 控制介面：排程覆寫（開/關/自動）與完整 RCON 能力。
package api

import (
	"context"
	"crypto/subtle"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"palscheduler/internal/config"
	"palscheduler/internal/palrest"
	"palscheduler/internal/presence"
	"palscheduler/internal/roster"
	"palscheduler/internal/scheduler"
)

// Server 封裝 Gin engine 與其依賴。
type Server struct {
	cfg         config.APIConfig
	sch         *scheduler.Scheduler
	rest        *palrest.Client   // Palworld 官方 REST API 用戶端；未啟用時為 nil
	presence    *presence.Tracker // 上線時數/次數追蹤；REST 未啟用時為 nil
	roster      *roster.Store     // 玩家頭像共用名冊（公開）
	palSaveURL  string            // 存檔解析 sidecar base URL；未啟用時為空
	palSaveHTTP *http.Client
	engine      *gin.Engine
}

// New 建立 API 伺服器並註冊路由。
func New(cfg *config.Config, sch *scheduler.Scheduler) *Server {
	gin.SetMode(gin.ReleaseMode)
	engine := gin.New()
	engine.Use(gin.Recovery())

	s := &Server{cfg: cfg.API, sch: sch, engine: engine}
	engine.Use(s.cors) // 讓瀏覽器 SPA 可跨源呼叫（前後端分離）
	if cfg.REST.IsEnabled() {
		s.rest = palrest.NewClient(cfg.REST.Host, cfg.REST.Port, cfg.REST.Password)
		// 上線時數/次數追蹤：定時輪詢 /players，JSON 持久化。
		path := os.Getenv("PRESENCE_PATH")
		if path == "" {
			path = "/app/data/presence.json"
		}
		interval := 60 * time.Second
		if v := os.Getenv("PRESENCE_INTERVAL_SECONDS"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				interval = time.Duration(n) * time.Second
			}
		}
		s.presence = presence.New(s.rest, path, interval, cfg.Location())
	}
	if cfg.PalSave.IsEnabled() {
		s.palSaveURL = strings.TrimRight(cfg.PalSave.URL, "/")
		s.palSaveHTTP = &http.Client{Timeout: 60 * time.Second} // 解析大存檔可能較久
	}
	// 玩家頭像共用名冊（無外部相依，一律啟用）
	rosterPath := os.Getenv("ROSTER_PATH")
	if rosterPath == "" {
		rosterPath = "/app/data/roster.json"
	}
	s.roster = roster.New(rosterPath)

	engine.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	// Swagger / OpenAPI 文件（免 token）：/openapi 規格、/openapi/view 互動介面
	s.registerDocs()

	// 玩家頭像共用名冊（公開、免 token）：玩家在面板自助設定，所有人可見。
	engine.GET("/api/roster", s.handleGetRoster)
	engine.POST("/api/roster", s.handleSetRoster)

	g := engine.Group("/api", s.auth)
	{
		// 排程覆寫
		g.GET("/status", s.handleStatus)
		g.POST("/start", s.handleStart)
		g.POST("/stop", s.handleStop)
		g.POST("/auto", s.handleAuto)

		// 完整 RCON
		g.POST("/rcon", s.handleRcon)                   // 任意指令（?command= 或 JSON {"command":"..."}）
		g.POST("/broadcast", s.handleBroadcast)         // ?msg=
		g.POST("/save", s.handleSave)                   // Save
		g.GET("/players", s.handleShowPlayers)          // ShowPlayers
		g.GET("/info", s.handleInfo)                    // Info
		g.POST("/kick", s.handleKick)                   // ?steamid=
		g.POST("/ban", s.handleBan)                     // ?steamid=
		g.POST("/unban", s.handleUnban)                 // ?steamid=
		g.POST("/shutdown", s.handleRconShutdown)       // ?seconds=&message=
		g.POST("/doexit", s.handleDoExit)               // DoExit（立即關閉）
		g.POST("/teleport", s.handleTeleport)           // ?steamid=&mode=toplayer|tome（需遊戲內管理員）
		g.POST("/spectate", s.handleSpectate)           // ToggleSpectate（需遊戲內管理員）
		g.POST("/adminpassword", s.handleAdminPassword) // ?password=（RCON 已驗證，通常不需）

		// 官方 REST API（port 8212）代理：回應為結構化 JSON，較 RCON 穩定
		rest := g.Group("/rest")
		{
			rest.GET("/info", s.handleRestInfo)
			rest.GET("/players", s.handleRestPlayers)
			rest.GET("/metrics", s.handleRestMetrics)
			rest.GET("/settings", s.handleRestSettings)
			rest.POST("/announce", s.handleRestAnnounce) // ?msg= 或 JSON {"message":"..."}
			rest.POST("/kick", s.handleRestKick)         // ?userid=&message=
			rest.POST("/ban", s.handleRestBan)           // ?userid=&message=
			rest.POST("/unban", s.handleRestUnban)       // ?userid=
			rest.POST("/save", s.handleRestSave)         // Save
			rest.POST("/shutdown", s.handleRestShutdown) // ?seconds=&message=
			rest.POST("/stop", s.handleRestStop)         // 立即強制停止
		}

		// 玩家帕魯資料（解析存檔，經 palsave sidecar）
		g.GET("/pals/players", s.handlePalsPlayers) // 玩家清單摘要（含 UID，不含每隻帕魯）
		g.GET("/pals", s.handlePals)                // ?q=<名稱|UID> 全部或單一玩家的完整帕魯

		// 上線時數/次數統計（後端定時輪詢累計，自啟用起）
		g.GET("/presence", s.handlePresence)
	}
	return s
}

// handlePresence 回傳玩家上線時數/次數統計（依線上總時數排序）。
func (s *Server) handlePresence(c *gin.Context) {
	if s.presence == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"ok":    false,
			"error": "上線追蹤未啟用（需 REST API 整合）",
		})
		return
	}
	c.JSON(http.StatusOK, s.presence.Snapshot())
}

// handleGetRoster 回傳全部玩家頭像名冊（公開，回傳陣列）。
func (s *Server) handleGetRoster(c *gin.Context) {
	c.JSON(http.StatusOK, s.roster.Get())
}

// handleSetRoster 由玩家自助設定自己的頭像：body {name, palId}。（公開）
func (s *Server) handleSetRoster(c *gin.Context) {
	var body struct {
		Name  string `json:"name"`
		PalID string `json:"palId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "需 JSON {name, palId}"})
		return
	}
	e, ok := s.roster.Set(body.Name, body.PalID)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "name 與 palId 不可為空"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "entry": e})
}

// handlePals 回傳玩家的完整帕魯資料。?q=<名稱或存檔UID> 只查符合的玩家。
func (s *Server) handlePals(c *gin.Context) { s.proxyPalSave(c, "/pals") }

// handlePalsPlayers 回傳玩家清單摘要（含 UID，不含每隻帕魯），方便先取得 UID。
func (s *Server) handlePalsPlayers(c *gin.Context) { s.proxyPalSave(c, "/players") }

// proxyPalSave 代理到 palsave sidecar 的指定路徑，並帶上 ?q=。
func (s *Server) proxyPalSave(c *gin.Context, path string) {
	if s.palSaveURL == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"ok":    false,
			"error": "存檔解析未啟用（config.json 的 palsave.enabled=false）",
		})
		return
	}
	u := s.palSaveURL + path
	uuid := c.Query("uuid")
	if uuid == "" {
		uuid = c.Query("q") // 相容舊參數
	}
	if uuid != "" {
		u += "?uuid=" + url.QueryEscape(uuid)
	}
	resp, err := s.palSaveHTTP.Get(u)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"ok": false, "error": "呼叫 palsave 失敗: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	c.DataFromReader(resp.StatusCode, resp.ContentLength,
		"application/json; charset=utf-8", resp.Body, nil)
}

// Run 啟動 HTTP 伺服器，並在 stop 關閉時優雅結束。
func (s *Server) Run(stop <-chan struct{}) error {
	if !s.cfg.Enabled {
		log.Println("[API] 已停用（api.enabled=false）")
		<-stop
		return nil
	}
	if s.presence != nil {
		go s.presence.Run(stop) // 上線追蹤輪詢
	}
	srv := &http.Server{Addr: s.cfg.Listen, Handler: s.engine}
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()
	log.Printf("[API] 監聽 %s", s.cfg.Listen)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// cors 設定跨源標頭，讓瀏覽器上的前端 SPA 能呼叫本 API。
// 驗證使用 Authorization/X-Auth-Token 標頭（非 cookie），故反射來源不帶 CSRF 風險。
// 白名單由 config.json 的 api.corsOrigins 控制（省略或含 "*" 時允許全部）。
// 預檢請求（OPTIONS）在此直接以 204 回應，不進入 auth。
func (s *Server) cors(c *gin.Context) {
	origin := c.GetHeader("Origin")
	if origin != "" && s.cfg.OriginAllowed(origin) {
		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Vary", "Origin")
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Authorization, X-Auth-Token, Content-Type")
		c.Header("Access-Control-Max-Age", "86400")
	}
	if c.Request.Method == http.MethodOptions {
		c.AbortWithStatus(http.StatusNoContent)
		return
	}
	c.Next()
}

// auth 驗證 token：X-Auth-Token 標頭、Authorization: Bearer、或 ?token=。
func (s *Server) auth(c *gin.Context) {
	got := c.GetHeader("X-Auth-Token")
	if got == "" {
		if b := c.GetHeader("Authorization"); strings.HasPrefix(b, "Bearer ") {
			got = strings.TrimPrefix(b, "Bearer ")
		}
	}
	if got == "" {
		got = c.Query("token")
	}
	if subtle.ConstantTimeCompare([]byte(got), []byte(s.cfg.Token)) != 1 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	c.Next()
}

// ---- 排程覆寫 ----

func (s *Server) handleStatus(c *gin.Context) { c.JSON(http.StatusOK, s.sch.Status()) }

func (s *Server) handleStart(c *gin.Context) {
	s.sch.ForceStart()
	c.JSON(http.StatusOK, gin.H{"ok": true, "action": "force_start"})
}

func (s *Server) handleStop(c *gin.Context) {
	countdown := 0
	if v := c.Query("countdown"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			countdown = n
		}
	}
	s.sch.ForceStop(countdown)
	c.JSON(http.StatusOK, gin.H{"ok": true, "action": "force_stop", "countdown": countdown})
}

func (s *Server) handleAuto(c *gin.Context) {
	s.sch.ResumeAuto()
	c.JSON(http.StatusOK, gin.H{"ok": true, "action": "resume_auto"})
}

// ---- 完整 RCON ----

// exec 送出指令並統一回應格式。
func (s *Server) exec(c *gin.Context, command string) {
	resp, err := s.sch.Rcon(command)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"ok": false, "command": command, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "command": command, "response": resp})
}

func (s *Server) handleRcon(c *gin.Context) {
	command := c.Query("command")
	if command == "" {
		var body struct {
			Command string `json:"command"`
		}
		_ = c.ShouldBindJSON(&body)
		command = body.Command
	}
	if strings.TrimSpace(command) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 command（?command= 或 JSON {\"command\":\"...\"}）"})
		return
	}
	s.exec(c, command)
}

func (s *Server) handleBroadcast(c *gin.Context) {
	msg := c.Query("msg")
	if msg == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 msg（訊息內請用底線代替空白）"})
		return
	}
	s.exec(c, "Broadcast "+msg)
}

func (s *Server) handleSave(c *gin.Context) { s.exec(c, "Save") }
func (s *Server) handleInfo(c *gin.Context) { s.exec(c, "Info") }

// handleShowPlayers 改走官方 REST：RCON 的 ShowPlayers 遇到含中文（多位元組）玩家名
// 會因帕魯回應封包長度算錯而讀取逾時，故優先用 REST 取得完整結構化玩家資料。
// REST 未啟用時才退回 RCON（此時含中文玩家可能逾時）。
func (s *Server) handleShowPlayers(c *gin.Context) {
	if s.rest == nil {
		s.exec(c, "ShowPlayers")
		return
	}
	players, err := s.rest.Players(c.Request.Context())
	if err != nil {
		restErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "players": players, "count": len(players)})
}

func (s *Server) handleKick(c *gin.Context)  { s.execSteamID(c, "KickPlayer") }
func (s *Server) handleBan(c *gin.Context)   { s.execSteamID(c, "BanPlayer") }
func (s *Server) handleUnban(c *gin.Context) { s.execSteamID(c, "UnBanPlayer") }

func (s *Server) execSteamID(c *gin.Context, verb string) {
	id := c.Query("steamid")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 steamid（可先呼叫 GET /api/players 取得）"})
		return
	}
	s.exec(c, verb+" "+id)
}

func (s *Server) handleRconShutdown(c *gin.Context) {
	seconds := 60
	if v := c.Query("seconds"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			seconds = n
		}
	}
	msg := c.Query("message")
	if msg == "" {
		msg = "Server_shutting_down"
	}
	s.exec(c, fmt.Sprintf("Shutdown %d %s", seconds, msg))
}

func (s *Server) handleTeleport(c *gin.Context) {
	id := c.Query("steamid")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 steamid"})
		return
	}
	verb := "TeleportToMe"
	if strings.EqualFold(c.Query("mode"), "toplayer") {
		verb = "TeleportToPlayer"
	}
	s.exec(c, verb+" "+id)
}

func (s *Server) handleDoExit(c *gin.Context)   { s.exec(c, "DoExit") }
func (s *Server) handleSpectate(c *gin.Context) { s.exec(c, "ToggleSpectate") }

func (s *Server) handleAdminPassword(c *gin.Context) {
	pw := c.Query("password")
	if pw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 password"})
		return
	}
	s.exec(c, "AdminPassword "+pw)
}
