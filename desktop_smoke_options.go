//go:build desktop_smoke

package main

import (
	"fmt"
	"log"
	"os"
	"strconv"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func desktopOptions() application.WindowsOptions {
	port, err := strconv.ParseUint(os.Getenv("MAKEUPMIRROR_SMOKE_PORT"), 10, 16)
	profile := os.Getenv("MAKEUPMIRROR_SMOKE_PROFILE")
	if err != nil || port == 0 || profile == "" {
		log.Fatal("桌面验收必须设置有效的调试端口和临时 WebView2 配置目录")
	}
	return application.WindowsOptions{
		WebviewUserDataPath: profile,
		AdditionalBrowserArgs: []string{
			"--remote-debugging-address=127.0.0.1",
			fmt.Sprintf("--remote-debugging-port=%d", port),
		},
	}
}
