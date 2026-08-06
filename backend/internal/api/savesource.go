// 存檔來源設定與「上傳存檔分析」。
//
// 為什麼需要:原本存檔路徑寫死在啟動環境(Docker 掛 backend/palworld-data、
// SteamCMD 版用 SAVE_ROOT),要改就得動 compose 或批次檔再重開服務。
// 這裡讓它變成可以用 API 指定的絕對路徑,面板也能直接看到「現在讀的是哪個世界」。
//
// 上傳分析則是給單機玩家用的:把自己的 Level.sav 丟上網頁看數據。
// 整份存檔只會在記憶體裡走一遍(Go 這層串流轉發、palsave 那層從 bytes 解析),
// 伺服器磁碟上不會留下任何副本。
package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
)

// maxUploadBytes 是「上傳存檔」的大小上限。
// 存檔通常幾十 MB;512 MB 足以涵蓋玩很久的大世界,又不至於讓單一請求把記憶體吃光。
const maxUploadBytes = 512 << 20

// handleSaveSourceGet 回報目前的存檔來源(根目錄、選中的世界、可用世界清單)。
func (s *Server) handleSaveSourceGet(c *gin.Context) {
	if s.palSaveURL == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"ok": false, "error": "存檔解析未啟用（config.json 的 palsave.enabled=false）",
		})
		return
	}
	resp, err := s.palSaveHTTP.Get(s.palSaveURL + "/source")
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"ok": false, "error": "呼叫 palsave 失敗: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	c.DataFromReader(resp.StatusCode, resp.ContentLength,
		"application/json; charset=utf-8", resp.Body, nil)
}

// handleSaveSourceSet 改用指定的絕對路徑當存檔根目錄。
//
// 路徑是在「跑排程器的那台機器」上解析的 —— Docker 版要注意:那是容器內的路徑,
// 主機上的資料夾必須先掛進容器才看得到,否則會回「找不到資料夾」。
func (s *Server) handleSaveSourceSet(c *gin.Context) {
	if s.palSaveURL == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"ok": false, "error": "存檔解析未啟用（config.json 的 palsave.enabled=false）",
		})
		return
	}
	var body struct {
		Root string `json:"root"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Root == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"ok": false, "error": `需 JSON {"root":"<存檔根目錄的絕對路徑>"}`,
		})
		return
	}
	payload, _ := json.Marshal(body)
	resp, err := s.palSaveHTTP.Post(s.palSaveURL+"/source",
		"application/json", bytes.NewReader(payload))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"ok": false, "error": "呼叫 palsave 失敗: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	// 換了世界就把預熱快取作廢,否則面板會繼續顯示上一個世界的玩家,
	// 而且要等下一次排程(預設 10 分鐘)才換過來。
	if resp.StatusCode == http.StatusOK && s.pals != nil {
		s.pals.Invalidate()
	}
	c.Data(resp.StatusCode, "application/json; charset=utf-8", out)
}

// handlePalsAnalyze 解析「使用者上傳的存檔」,回傳與 /api/pals 相同結構。
//
// 刻意用串流轉發而不是先讀進 []byte 再送:存檔可能幾百 MB,
// 全部收進記憶體只為了原樣轉出去沒有意義。MaxBytesReader 負責擋過大的檔案。
// 這條路徑不碰磁碟,也不會動到伺服器本身的存檔快取。
func (s *Server) handlePalsAnalyze(c *gin.Context) {
	if s.palSaveURL == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"ok": false, "error": "存檔解析未啟用（config.json 的 palsave.enabled=false）",
		})
		return
	}
	src := io.Reader(http.MaxBytesReader(c.Writer, c.Request.Body, maxUploadBytes))

	// multipart 表單(瀏覽器 <input type=file> 的預設送法)先取出檔案本體;
	// 其餘情況視為 body 就是整份存檔(curl --data-binary)。
	if ct := c.ContentType(); ct == "multipart/form-data" {
		f, hdr, err := c.Request.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "找不到上傳欄位 file"})
			return
		}
		defer f.Close()
		if hdr.Size > maxUploadBytes {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{
				"ok": false, "error": "檔案太大（上限 512 MB）",
			})
			return
		}
		src = f
	}

	req, err := http.NewRequestWithContext(c.Request.Context(),
		http.MethodPost, s.palSaveURL+"/analyze", src)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	// Content-Length 已知時要帶上 —— palsave 靠它決定要讀多少,
	// 不帶的話 Go 會用 chunked 傳輸,那邊的 Content-Length 就成了 0。
	if cl := c.Request.ContentLength; cl > 0 && c.ContentType() != "multipart/form-data" {
		req.ContentLength = cl
	} else if f, ok := src.(interface{ Size() int64 }); ok {
		req.ContentLength = f.Size()
	}

	resp, err := s.palSaveHTTP.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"ok": false, "error": "呼叫 palsave 失敗: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	c.DataFromReader(resp.StatusCode, resp.ContentLength,
		"application/json; charset=utf-8", resp.Body, nil)
}
