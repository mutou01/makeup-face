//go:build !windows

package provider

func systemImageProxy() (string, string) { return "", "" }
