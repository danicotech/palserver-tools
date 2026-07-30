package api

import (
	_ "embed"
	"net/http"

	"github.com/gin-gonic/gin"
)

//go:embed openapi.json
var openapiSpec []byte

// swaggerHTML 是 Swagger UI 頁面，從 CDN 載入資源並指向本服務的 /openapi 規格。
// 使用者可在此頁 Authorize（填 token）後對各端點 Try it out 直接調用。
const swaggerHTML = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Palworld Scheduler API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
  <style>body{margin:0}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: "/openapi",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        tryItOutEnabled: true
      });
    };
  </script>
</body>
</html>`

// registerDocs 註冊文件路由（皆免 token，方便查閱）。
func (s *Server) registerDocs() {
	s.engine.GET("/openapi", func(c *gin.Context) {
		c.Data(http.StatusOK, "application/json; charset=utf-8", openapiSpec)
	})
	// /openapi/view 與尾斜線版本皆可存取
	view := func(c *gin.Context) {
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(swaggerHTML))
	}
	s.engine.GET("/openapi/view", view)
	s.engine.GET("/openapi/view/", view)
}
