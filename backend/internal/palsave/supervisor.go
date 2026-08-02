// Package palsave 讓排程器直接帶起存檔解析服務（Python）。
//
// 為什麼要這樣做：
// SteamCMD 版原本由 start-all.bat 另外 start 一個視窗跑 palsave，畫面上因此
// 同時有「啟動器 + palsave + 排程器」三個黑視窗，使用者不知道哪個能關、
// 關錯一個網站就查不到資料。改由排程器當爸爸帶起來之後：
//   - 視窗合而為一：palsave 的訊息直接印在排程器視窗裡
//   - 生命週期綁定：排程器停，palsave 跟著停，不會留孤兒佔住 8213
//   - 掛了會自己重開：palsave 死掉等於整個查詢網站沒資料，不該靜靜地壞掉
//
// Docker 版不受影響：那邊 palsave 是獨立容器由 compose 管，
// 只有在 PALSAVE_SPAWN=1 時（start-all 腳本會設）本套機制才啟用。
package palsave

import (
	"bufio"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// 重開間隔。設短一點沒意義：python 起不來多半是套件沒裝好，
// 狂重試只會把畫面洗滿一樣的錯誤訊息。
const restartDelay = 5 * time.Second

// Supervisor 監管一個 palsave 子行程。
type Supervisor struct {
	python   string // python 執行檔（預設 python，可用 PALSAVE_PYTHON 指定）
	dir      string // server.py 所在資料夾
	saveRoot string // 存檔根目錄
	port     string // 監聽埠
	logPath  string // 另外落地一份記錄；空字串＝只印在畫面上
}

// NewFromEnv 依環境變數決定是否啟用；未啟用時回 nil（呼叫端直接略過）。
func NewFromEnv() *Supervisor {
	if os.Getenv("PALSAVE_SPAWN") != "1" {
		return nil
	}
	dir := os.Getenv("PALSAVE_DIR")
	if dir == "" {
		return nil
	}
	if _, err := os.Stat(filepath.Join(dir, "server.py")); err != nil {
		log.Printf("[palsave] 找不到 %s，略過自動啟動", filepath.Join(dir, "server.py"))
		return nil
	}
	python := os.Getenv("PALSAVE_PYTHON")
	if python == "" {
		python = "python"
	}
	port := os.Getenv("PALSAVE_PORT")
	if port == "" {
		port = "8213"
	}
	return &Supervisor{
		python:   python,
		dir:      dir,
		saveRoot: os.Getenv("SAVE_ROOT"),
		port:     port,
		logPath:  os.Getenv("PALSAVE_LOG"),
	}
}

// Run 帶起 palsave 並持續監看，直到 stop 關閉。呼叫端應以 goroutine 執行。
func (s *Supervisor) Run(stop <-chan struct{}) {
	for {
		cmd, done, err := s.launch()
		if err != nil {
			log.Printf("[palsave] 啟動失敗:%v", err)
			select {
			case <-stop:
				return
			case <-time.After(restartDelay):
				continue
			}
		}
		select {
		case <-stop:
			// 排程器要收工了，把 palsave 一起帶走，不留孤兒佔著埠
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
			<-done
			log.Println("[palsave] 已隨排程器停止")
			return
		case err := <-done:
			// 非預期結束（多半是 Python 套件缺失或存檔路徑錯）
			if err != nil {
				log.Printf("[palsave] 結束:%v，%s 後重開", err, restartDelay)
			} else {
				log.Printf("[palsave] 結束,%s 後重開", restartDelay)
			}
			select {
			case <-stop:
				return
			case <-time.After(restartDelay):
			}
		}
	}
}

// launch 起一個 palsave 子行程，回傳它與「結束通知」channel。
func (s *Supervisor) launch() (*exec.Cmd, chan error, error) {
	cmd := exec.Command(s.python, "server.py")
	cmd.Dir = s.dir
	cmd.Env = append(os.Environ(), "SAVE_ROOT="+s.saveRoot, "PORT="+s.port,
		// Python 預設會把 stdout 緩衝起來，透過 pipe 讀時訊息會卡住不出現，
		// 讓人以為解析當掉了。關掉緩衝才能即時看到「解析完成:N 位玩家」。
		"PYTHONUNBUFFERED=1", "PYTHONIOENCODING=utf-8")
	hideWindow(cmd) // Windows：不要再彈一個黑視窗出來

	// 自己開 pipe 而不用 cmd.StdoutPipe()：後者的 Wait() 會在看到行程結束時
	// 立刻關掉管線，跟還在讀的 relay 搶,最後幾行訊息(常常正是錯誤原因)會不見。
	pr, pw, err := os.Pipe()
	if err != nil {
		return nil, nil, err
	}
	cmd.Stdout = pw
	cmd.Stderr = pw // stderr 併進同一條，順序才不會亂
	if err := cmd.Start(); err != nil {
		pr.Close()
		pw.Close()
		return nil, nil, err
	}
	pw.Close() // 父行程放掉自己那份，子行程結束時 relay 才會讀到 EOF
	log.Printf("[palsave] 已啟動(:%s,存檔 %s)", s.port, s.saveRoot)

	done := make(chan error, 1)
	go func() {
		s.relay(pr) // 一路讀到 EOF（＝子行程真的結束了）
		pr.Close()
		done <- cmd.Wait() // 訊息都收完了才回收
	}()
	return cmd, done, nil
}

// relay 把子行程的輸出逐行轉印到排程器的記錄，順便落地一份。
func (s *Supervisor) relay(r io.Reader) {
	var file *os.File
	if s.logPath != "" {
		if err := os.MkdirAll(filepath.Dir(s.logPath), 0o755); err == nil {
			file, _ = os.OpenFile(s.logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
		}
	}
	if file != nil {
		defer file.Close()
	}
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024) // 解析摘要有機會很長
	for sc.Scan() {
		line := strings.TrimRight(sc.Text(), "\r")
		if line == "" {
			continue
		}
		log.Println(line) // 與排程器同一個視窗、同一種時間戳
		if file != nil {
			_, _ = file.WriteString(time.Now().Format("2006/01/02 15:04:05 ") + line + "\n")
		}
	}
}
