package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// 本檔為 Palworld 官方 REST API（port 8212）的代理端點，掛在 /api/rest/*。
// 相較於 RCON，官方 REST 回應為結構化 JSON（含等級、座標、FPS、天數等），且較穩定。

// restReady 確認 REST 用戶端已啟用；未啟用時回 503 並回傳 false。
func (s *Server) restReady(c *gin.Context) bool {
	if s.rest == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"ok":    false,
			"error": "REST API 整合未啟用（config.json 的 rest.enabled=false，或伺服器未開啟 RESTAPIEnabled）",
		})
		return false
	}
	return true
}

// restErr 統一把 palrest 的錯誤轉為 502。
func restErr(c *gin.Context, err error) {
	c.JSON(http.StatusBadGateway, gin.H{"ok": false, "error": err.Error()})
}

func (s *Server) handleRestInfo(c *gin.Context) {
	if !s.restReady(c) {
		return
	}
	info, err := s.rest.Info(c.Request.Context())
	if err != nil {
		restErr(c, err)
		return
	}
	c.JSON(http.StatusOK, info)
}

func (s *Server) handleRestPlayers(c *gin.Context) {
	if !s.restReady(c) {
		return
	}
	players, err := s.rest.Players(c.Request.Context())
	if err != nil {
		restErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"players": players, "count": len(players)})
}

func (s *Server) handleRestMetrics(c *gin.Context) {
	if !s.restReady(c) {
		return
	}
	m, err := s.rest.Metrics(c.Request.Context())
	if err != nil {
		restErr(c, err)
		return
	}
	c.JSON(http.StatusOK, m)
}

func (s *Server) handleRestSettings(c *gin.Context) {
	if !s.restReady(c) {
		return
	}
	st, err := s.rest.Settings(c.Request.Context())
	if err != nil {
		restErr(c, err)
		return
	}
	c.JSON(http.StatusOK, st)
}

func (s *Server) handleRestAnnounce(c *gin.Context) {
	if !s.restReady(c) {
		return
	}
	msg := c.Query("msg")
	if msg == "" {
		var body struct {
			Message string `json:"message"`
		}
		_ = c.ShouldBindJSON(&body)
		msg = body.Message
	}
	if strings.TrimSpace(msg) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "缺少 msg（?msg= 或 JSON {\"message\":\"...\"}）"})
		return
	}
	if err := s.rest.Announce(c.Request.Context(), msg); err != nil {
		restErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": msg})
}

func (s *Server) handleRestKick(c *gin.Context) { s.restUserAction(c, "kick") }
func (s *Server) handleRestBan(c *gin.Context)  { s.restUserAction(c, "ban") }

// restUserAction 處理 kick / ban（皆需 userid，可帶 message）。
func (s *Server) restUserAction(c *gin.Context, action string) {
	if !s.restReady(c) {
		return
	}
	userid := c.Query("userid")
	if userid == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "缺少 userid（可先呼叫 GET /api/rest/players 取得 userId）"})
		return
	}
	message := c.Query("message")
	var err error
	if action == "kick" {
		err = s.rest.Kick(c.Request.Context(), userid, message)
	} else {
		err = s.rest.Ban(c.Request.Context(), userid, message)
	}
	if err != nil {
		restErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "action": action, "userid": userid})
}

func (s *Server) handleRestUnban(c *gin.Context) {
	if !s.restReady(c) {
		return
	}
	userid := c.Query("userid")
	if userid == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "缺少 userid"})
		return
	}
	if err := s.rest.Unban(c.Request.Context(), userid); err != nil {
		restErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "action": "unban", "userid": userid})
}

func (s *Server) handleRestSave(c *gin.Context) {
	if !s.restReady(c) {
		return
	}
	if err := s.rest.Save(c.Request.Context()); err != nil {
		restErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "action": "save"})
}

func (s *Server) handleRestShutdown(c *gin.Context) {
	if !s.restReady(c) {
		return
	}
	seconds := 60
	if v := c.Query("seconds"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			seconds = n
		}
	}
	msg := c.Query("message")
	if msg == "" {
		msg = "Server shutting down"
	}
	if err := s.rest.Shutdown(c.Request.Context(), seconds, msg); err != nil {
		restErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "action": "shutdown", "waittime": seconds, "message": msg})
}

func (s *Server) handleRestStop(c *gin.Context) {
	if !s.restReady(c) {
		return
	}
	if err := s.rest.Stop(c.Request.Context()); err != nil {
		restErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "action": "stop"})
}
