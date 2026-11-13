package provider

import (
	"net/http"
	"slices"
	"strings"
	"testing"
)

func TestCodexCommandUsesLocalProxyWithoutOverwritingExplicitSettings(t *testing.T) {
	for _, tc := range []struct {
		env    []string
		bypass string
		want   string
	}{
		{[]string{"PATH=fixture"}, "", "HTTPS_PROXY=http://127.0.0.1:7890"},
		{[]string{"PATH=fixture", "https_proxy=http://example.test:80"}, "", "https_proxy=http://example.test:80"},
		{[]string{"PATH=fixture"}, "*.chatgpt.com;chatgpt.com", ""},
	} {
		got := codexProxyEnvironment(tc.env, "127.0.0.1:7890", tc.bypass)
		if tc.want != "" && !slices.Contains(got, tc.want) {
			t.Fatalf("missing proxy entry: %q", got)
		}
		if tc.want == "" && slices.ContainsFunc(got, func(s string) bool { return strings.HasPrefix(strings.ToUpper(s), "HTTPS_PROXY=") }) {
			t.Fatalf("unexpected proxy entry: %q", got)
		}
	}
}

func TestMicuUsesOnlyConfiguredLoopbackProxy(t *testing.T) {
	for _, tc := range []struct{ address, bypass, target, want string }{
		{"127.0.0.1:7890", "", "https://www.micuapi.ai/v1/images/edits", "http://127.0.0.1:7890"},
		{"http=localhost:8000;https=localhost:7890", "", "https://www.micuapi.ai/v1/images/edits", "http://localhost:7890"},
		{"127.0.0.1:7890", "*.micuapi.ai", "https://www.micuapi.ai/v1/images/edits", ""},
		{"127.0.0.1:7890", "", "https://other.example/v1/images/edits", ""},
		{"127.0.0.1:7890", "", "https://www.micuapi.ai:8443/v1/images/edits", ""},
		{"127.0.0.1:7890", "", "https://www.micuapi.ai/v1/models", ""},
		{"192.168.1.2:7890", "", "https://www.micuapi.ai/v1/images/edits", ""},
	} {
		r, err := http.NewRequest(http.MethodPost, tc.target, nil)
		if err != nil {
			t.Fatal(err)
		}
		transport := newImageHTTPClient(tc.address, tc.bypass).Transport.(*http.Transport)
		got := ""
		if transport.Proxy != nil {
			p, err := transport.Proxy(r)
			if err != nil {
				t.Fatal(err)
			}
			if p != nil {
				got = p.String()
			}
		}
		if got != tc.want {
			t.Errorf("proxy for %s = %q, want %q", tc.target, got, tc.want)
		}
	}
}
