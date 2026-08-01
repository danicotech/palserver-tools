// 由排程器本體提供查詢網站的靜態檔——給「SteamCMD 版」用（沒有 Docker、沒有 nginx）。
//
// Docker 版是 nginx 提供靜態檔並反向代理 /api，token 由 nginx 注入,
// 瀏覽器不必持有。這裡要達到同樣效果：同源提供網站 + 同一個 process 提供 API,
// 所以把 nginx 白名單裡那組「唯讀端點」在本機同源請求時免 token 放行,
// 控制類端點（start/stop/rcon/kick…）一律仍需 token，安全邊界與 Docker 版一致。
package api

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
)

// publicReadPath 與 frontend/nginx.conf 的白名單同一組：
// 只有唯讀查詢與玩家自助頭像，沒有任何會動到伺服器的端點。
var publicReadPath = regexp.MustCompile(`^/api/(pals|status|presence|roster|rest/(metrics|info|players|settings))$`)

// registerPanel 掛上靜態網站與 SPA fallback。
func (s *Server) registerPanel(engine *gin.Engine, dir string) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		abs = dir
	}
	index := filepath.Join(abs, "index.html")
	if _, err := os.Stat(index); err != nil {
		// 沒建置就別掛，免得整站 404 讓人以為壞了
		return
	}
	s.panelDir = abs
	fs := http.Dir(abs)
	fileServer := http.FileServer(fs)

	engine.NoRoute(func(c *gin.Context) {
		p := c.Request.URL.Path
		// /api 與文件端點不吃 SPA fallback，維持原本的 404/401 語意
		if strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/openapi") || p == "/healthz" {
			c.JSON(http.StatusNotFound, gin.H{"ok": false, "error": "not found"})
			return
		}
		// 實體檔就直接送（assets/*、圖片、game-data JSON…）
		if f, err := fs.Open(strings.TrimPrefix(p, "/")); err == nil {
			st, serr := f.Stat()
			_ = f.Close()
			if serr == nil && !st.IsDir() {
				if strings.HasPrefix(p, "/assets/") {
					c.Header("Cache-Control", "public, max-age=2592000, immutable") // 檔名含 hash
				}
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}
		}
		// 其餘一律回 index.html（單頁應用的路由不會 404）
		c.File(index)
	})
}

// panelPublicRead 判斷這個請求可不可以免 token：
// 必須是 registerPanel 有啟用（代表本程式就是網站本身），且落在唯讀白名單內。
func (s *Server) panelPublicRead(c *gin.Context) bool {
	if s.panelDir == "" {
		return false
	}
	if c.Request.Method != http.MethodGet {
		return false
	}
	return publicReadPath.MatchString(c.Request.URL.Path)
}
