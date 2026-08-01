//go:build !windows

package procctl

import (
	"os/exec"
	"syscall"
)

// detach 讓伺服器自成一個 session:排程器結束時不會收到同一組訊號。
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
