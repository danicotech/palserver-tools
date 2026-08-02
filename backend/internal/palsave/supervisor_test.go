package palsave

import (
	"bytes"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// 真的把 palsave 跑起來、再把它收掉。會用到系統上的 python 與存檔解析套件，
// 缺任何一項就跳過（CI 沒有這些東西是正常的）。
func TestSupervisorStartsAndStops(t *testing.T) {
	python, err := exec.LookPath("python")
	if err != nil {
		python, err = exec.LookPath("python3")
		if err != nil {
			t.Skip("沒有 python，跳過")
		}
	}
	dir, err := filepath.Abs("../../tools/palsave")
	if err != nil || !fileExists(filepath.Join(dir, "server.py")) {
		t.Skip("找不到 palsave/server.py，跳過")
	}
	if exec.Command(python, "-c", "import ooz, palworld_save_tools").Run() != nil {
		t.Skip("解析套件未安裝，跳過")
	}

	const port = "8297"
	if !portFree(port) {
		t.Skipf("埠 %s 已被佔用,跳過", port)
	}

	// 空的存檔根目錄——只要服務起得來就好，不需要真的有存檔
	saveRoot := t.TempDir()
	logPath := filepath.Join(t.TempDir(), "palsave.log")

	t.Setenv("PALSAVE_SPAWN", "1")
	t.Setenv("PALSAVE_DIR", dir)
	t.Setenv("PALSAVE_PYTHON", python)
	t.Setenv("PALSAVE_PORT", port)
	t.Setenv("PALSAVE_LOG", logPath)
	t.Setenv("SAVE_ROOT", saveRoot)

	sup := NewFromEnv()
	if sup == nil {
		t.Fatal("NewFromEnv 回 nil，應該要啟用")
	}

	// 攔下 log 輸出，驗證子行程的訊息真的有被轉印到排程器的記錄裡
	var logbuf bytes.Buffer
	old := log.Writer()
	log.SetOutput(&logbuf)
	defer log.SetOutput(old)

	stop := make(chan struct{})
	done := make(chan struct{})
	go func() { sup.Run(stop); close(done) }()

	if !waitFor(30*time.Second, func() bool { return healthy(port) }) {
		t.Fatalf("palsave 沒有在時限內起來。log:\n%s", logbuf.String())
	}

	// 子行程的 stdout 有沒有被接進來（palsave 啟動時會印一行 "[palsave] 監聽 :port"）
	if !waitFor(5*time.Second, func() bool { return strings.Contains(logbuf.String(), "監聽 :"+port) }) {
		t.Errorf("子行程輸出沒有轉印到排程器記錄。目前內容:\n%s", logbuf.String())
	}
	// 也該落地一份
	if b, err := os.ReadFile(logPath); err != nil || !strings.Contains(string(b), "監聽") {
		t.Errorf("記錄檔沒寫成功:err=%v 內容=%q", err, string(b))
	}

	close(stop)
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("Run 沒有在 stop 之後收工")
	}

	// 最重要的一點:排程器停掉後不能留下孤兒佔著埠
	if !waitFor(10*time.Second, func() bool { return portFree(port) }) {
		t.Errorf("palsave 沒有被一起帶走，埠 %s 仍被佔用", port)
	}
}

func TestNewFromEnvDisabledByDefault(t *testing.T) {
	t.Setenv("PALSAVE_SPAWN", "")
	if NewFromEnv() != nil {
		t.Error("沒設 PALSAVE_SPAWN 時不該啟用（Docker 版靠這個跳過）")
	}
	t.Setenv("PALSAVE_SPAWN", "1")
	t.Setenv("PALSAVE_DIR", "")
	if NewFromEnv() != nil {
		t.Error("沒有 PALSAVE_DIR 時不該啟用")
	}
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

func portFree(port string) bool {
	l, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		return false
	}
	l.Close()
	return true
}

func healthy(port string) bool {
	c := &http.Client{Timeout: time.Second}
	resp, err := c.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return true
}

func waitFor(d time.Duration, ok func() bool) bool {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if ok() {
			return true
		}
		time.Sleep(200 * time.Millisecond)
	}
	return ok()
}
