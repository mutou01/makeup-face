//go:build !windows

package provider

import "os/exec"

func hideCodexWindow(_ *exec.Cmd) {}
