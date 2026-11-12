//go:build !desktop_smoke

package main

import "github.com/wailsapp/wails/v3/pkg/application"

func desktopOptions() application.WindowsOptions {
	return application.WindowsOptions{}
}

func desktopPhotoPicker(window application.Window) func() (string, error) {
	return nativePhotoPicker(window)
}
