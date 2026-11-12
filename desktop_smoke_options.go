//go:build desktop_smoke

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func desktopPhotoPicker(window application.Window) func() (string, error) {
	raw := os.Getenv("MAKEUPMIRROR_SMOKE_PHOTO_SELECTIONS")
	if raw == "" {
		return nativePhotoPicker(window)
	}
	var selections []string
	if err := json.Unmarshal([]byte(raw), &selections); err != nil {
		log.Fatal("桌面验收照片列表无效")
	}
	return func() (string, error) {
		if len(selections) == 0 {
			return "", nil
		}
		selected := selections[0]
		selections = selections[1:]
		return selected, nil
	}
}

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
