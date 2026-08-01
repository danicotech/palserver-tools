// 帕魯伺服器選單啟動器:給不熟指令的人一個數字選單。
// 編譯(需安裝 Go):
//
//	cd tools/launcher && go build -o ../../palserver.exe .   (Windows)
//	cd tools/launcher && go build -o ../../palserver .       (Linux/macOS)
//
// 把產出的執行檔放在專案根目錄雙擊即可;功能等同 一鍵啟動/重啟/停止/查看狀態 腳本。
package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func run(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	return cmd.Run()
}

// firstRunSetup 呼叫對應平台的 setup 腳本(產生 .env / config.json;已存在則跳過)。
func firstRunSetup() {
	if runtime.GOOS == "windows" {
		_ = run("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", filepath.Join("windows", "setup.ps1"))
	} else {
		_ = run("bash", filepath.Join("linux", "setup.sh"))
	}
}

func main() {
	// 切到執行檔所在目錄(雙擊時工作目錄可能不對)
	if exe, err := os.Executable(); err == nil {
		_ = os.Chdir(filepath.Dir(exe))
	}
	if _, err := exec.LookPath("docker"); err != nil {
		fmt.Println("[X] 找不到 Docker!請先安裝並啟動 Docker Desktop:")
		fmt.Println("    https://www.docker.com/products/docker-desktop/")
		pause()
		return
	}

	reader := bufio.NewReader(os.Stdin)
	for {
		fmt.Println()
		fmt.Println("========= 帕魯伺服器 控制選單 =========")
		fmt.Println("  1) 一鍵啟動(首次自動產生密碼)")
		fmt.Println("  2) 重啟服務(套用 .env 新設定)")
		fmt.Println("  3) 停止服務")
		fmt.Println("  4) 查看狀態與日誌")
		fmt.Println("  5) 只更新查詢網站(重建前端)")
		fmt.Println("  0) 離開")
		fmt.Print("請輸入數字後按 Enter:")
		line, _ := reader.ReadString('\n')
		switch strings.TrimSpace(line) {
		case "1":
			firstRunSetup()
			_ = run("docker", "compose", "up", "-d", "--build")
			fmt.Println("完成!查詢網站:http://localhost")
		case "2":
			_ = run("docker", "compose", "up", "-d", "--build")
			fmt.Println("完成!")
		case "3":
			_ = run("docker", "compose", "stop")
			fmt.Println("已全部停止。")
		case "4":
			_ = run("docker", "compose", "ps")
			_ = run("docker", "compose", "logs", "--tail", "20", "scheduler")
		case "5":
			_ = run("docker", "compose", "up", "-d", "--no-deps", "--build", "panel")
			fmt.Println("網站已更新:http://localhost")
		case "0":
			return
		default:
			fmt.Println("請輸入 0-5")
		}
	}
}

func pause() {
	fmt.Print("按 Enter 結束...")
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
}
