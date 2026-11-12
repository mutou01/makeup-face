//go:build !desktop_smoke

package main

import "github.com/wailsapp/wails/v3/pkg/application"

func desktopOptions() application.WindowsOptions {
	return application.WindowsOptions{}
}
