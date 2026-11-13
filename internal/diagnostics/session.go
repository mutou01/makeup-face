package diagnostics

import (
	"sync"
	"time"
)

type Operation string
type Outcome string
type Code string

const (
	Analyze Operation = "face_analysis"
	Create  Operation = "project_create"
	Open    Operation = "project_open"
	Save    Operation = "project_save"
	Close   Operation = "project_close"
	Remove  Operation = "project_remove_photo"
	Export  Operation = "preview_export"

	Success  Outcome = "success"
	Failed   Outcome = "failed"
	Canceled Outcome = "canceled"

	None          Code = "none"
	Unavailable   Code = "unavailable"
	NoFace        Code = "no_face"
	MultipleFaces Code = "multiple_faces"
)

const limit = 32

type Event struct {
	Operation Operation `json:"operation"`
	Outcome   Outcome   `json:"outcome"`
	Code      Code      `json:"code"`
	Duration  string    `json:"durationBucket"`
	Time      time.Time `json:"time"`
}

type Snapshot struct {
	Version int     `json:"schemaVersion"`
	Events  []Event `json:"events"`
}

// Session contains only a bounded set of diagnostic events. It does not write files.
type Session struct {
	mu     sync.Mutex
	events []Event
}

func (s *Session) Record(operation Operation, outcome Outcome, code Code, start time.Time) {
	switch operation {
	case Analyze, Create, Open, Save, Close, Remove, Export:
	default:
		return
	}
	switch outcome {
	case Success, Failed, Canceled:
	default:
		return
	}
	switch code {
	case None, Unavailable, NoFace, MultipleFaces:
	default:
		return
	}
	now := time.Now()
	duration := "10s_or_more"
	switch elapsed := now.Sub(start); {
	case elapsed < 100*time.Millisecond:
		duration = "under_100ms"
	case elapsed < time.Second:
		duration = "100ms_to_1s"
	case elapsed < 10*time.Second:
		duration = "1s_to_10s"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.events) == limit {
		copy(s.events, s.events[1:])
		s.events = s.events[:limit-1]
	}
	s.events = append(s.events, Event{operation, outcome, code, duration, now.UTC().Truncate(time.Minute)})
}

func (s *Session) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Snapshot{Version: 1, Events: append([]Event{}, s.events...)}
}
