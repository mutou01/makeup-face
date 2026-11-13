package main

import "makeupmirror/internal/diagnostics"

type DiagnosticsService struct {
	session *diagnostics.Session
}

func (s *DiagnosticsService) Snapshot() diagnostics.Snapshot {
	return s.session.Snapshot()
}
