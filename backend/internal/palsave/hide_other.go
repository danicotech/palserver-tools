//go:build !windows

package palsave

import "os/exec"

// Linux/macOS 沒有「視窗」的概念，子行程本來就跟著排程器的終端機走。
func hideWindow(*exec.Cmd) {}
