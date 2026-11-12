package main

import (
	"context"
	"net/http"
	"sync"

	"makeupmirror/internal/provider"
)

type ProviderService struct {
	store  *provider.Store
	client *http.Client
	mu     sync.Mutex
	active *activeExplanation
}

type activeExplanation struct{ cancel context.CancelFunc }

func (s *ProviderService) GetSettings() (provider.View, error) { return s.store.View() }
func (s *ProviderService) SaveSettings(input provider.Input) (provider.View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopExplanation()
	return s.store.Save(input)
}
func (s *ProviderService) ForgetKey() (provider.View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopExplanation()
	return s.store.ForgetKey()
}

func (s *ProviderService) stopExplanation() {
	if s.active != nil {
		s.active.cancel()
		s.active = nil
	}
}

func (s *ProviderService) Explain(ctx context.Context, input provider.ExplainInput) (string, error) {
	s.mu.Lock()
	s.stopExplanation()
	ctx, cancel := context.WithCancel(ctx)
	request := &activeExplanation{cancel: cancel}
	s.active = request
	s.mu.Unlock()
	defer func() {
		cancel()
		s.mu.Lock()
		if s.active == request {
			s.active = nil
		}
		s.mu.Unlock()
	}()
	return s.store.Explain(ctx, s.client, input)
}
