package main

import (
	"encoding/json"
	"errors"
	"os"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"makeupmirror/internal/diagnostics"
	"makeupmirror/internal/project"
)

type DiagnosticsService struct {
	session    *diagnostics.Session
	pickExport func() (string, error)
	busy       atomic.Bool
}

func (s *DiagnosticsService) Snapshot() diagnostics.Snapshot {
	return s.session.Snapshot()
}

func nativeDiagnosticPicker(window application.Window) func() (string, error) {
	return func() (string, error) {
		return application.Get().Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
			Title: "导出诊断 JSON", Filename: "makeupmirror-diagnostics.json", Window: window,
			Filters: []application.FileFilter{{DisplayName: "JSON 文档", Pattern: "*.json"}},
		}).PromptForSingleSelection()
	}
}

func (s *DiagnosticsService) Export() string {
	if !s.busy.CompareAndSwap(false, true) {
		return "正在导出诊断，请稍候。"
	}
	defer s.busy.Store(false)
	path, err := s.pickExport()
	if err != nil || path == "" {
		return "未导出诊断。"
	}
	data, err := json.MarshalIndent(s.session.Snapshot(), "", "  ")
	if err != nil {
		return "无法编码诊断。"
	}
	if err := project.WriteDiagnostic(path, append(data, '\n')); err != nil {
		if errors.Is(err, os.ErrExist) {
			return "文件已存在，未覆盖。"
		}
		return "无法保存诊断，请检查目标路径和权限。"
	}
	return "诊断已导出。"
}
