package provider

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const explanationTimeout = 8 * time.Second
const maxResponseBytes = 32 * 1024
const instructions = "用简体中文写一两句妆容搭配理由，不推断个人特征。预设编号含义：daily-rose 为日常豆沙，photo-peach 为蜜桃暖妆，party-berry 为莓果夜妆。"

var (
	errUnavailable   = errors.New("AI 解释暂不可用，仍可参考本地说明。")
	errInput         = errors.New("仅支持本地推荐的场景、妆感和预设编号。")
	sharedAddress    = netip.MustParsePrefix("100.64.0.0/10")
	benchmarkAddress = netip.MustParsePrefix("198.18.0.0/15")
	globalIPv6       = netip.MustParsePrefix("2000::/3")
)

type ExplainInput struct {
	Scene    string `json:"scene"`
	Look     string `json:"look"`
	PresetID string `json:"preset_id"`
}

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func (s *Store) Explain(ctx context.Context, client *http.Client, input ExplainInput) (string, error) {
	if !validInput(input) {
		return "", errInput
	}
	if client == nil {
		return "", errUnavailable
	}
	c, key, err := s.credentials()
	if err != nil {
		return "", errUnavailable
	}
	defer clear(key)

	// Only this closed, validated set of business values enters the request body.
	selection, err := json.Marshal(input)
	if err != nil {
		return "", errUnavailable
	}
	payload, err := json.Marshal(struct {
		Model     string    `json:"model"`
		Messages  []message `json:"messages"`
		Stream    bool      `json:"stream"`
		MaxTokens int       `json:"max_tokens"`
	}{Model: c.Model, Messages: []message{{Role: "system", Content: instructions}, {Role: "user", Content: string(selection)}}, MaxTokens: 160})
	if err != nil {
		return "", errUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, explanationTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", errUnavailable
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+string(key))
	bounded := *client
	bounded.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := bounded.Do(req)
	if err != nil {
		return "", errUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", errUnavailable
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil || len(data) > maxResponseBytes {
		return "", errUnavailable
	}
	var output struct {
		Choices []struct {
			Message message `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(data, &output) != nil || len(output.Choices) == 0 {
		return "", errUnavailable
	}
	text := strings.TrimSpace(output.Choices[0].Message.Content)
	if text == "" || !utf8.ValidString(text) || utf8.RuneCountInString(text) > 240 || strings.Contains(text, string(key)) {
		return "", errUnavailable
	}
	for _, r := range text {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return "", errUnavailable
		}
	}
	return text, nil
}

func validInput(input ExplainInput) bool {
	switch input.Scene {
	case "any", "daily", "photo", "party":
	default:
		return false
	}
	switch input.Look {
	case "any", "natural", "warm", "bold":
	default:
		return false
	}
	switch input.PresetID {
	case "daily-rose", "photo-peach", "party-berry":
		return true
	}
	return false
}

func (s *Store) credentials() (config, []byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, err := s.read()
	if err != nil || !c.Enabled || c.CredentialID == "" {
		return config{}, nil, errUnavailable
	}
	key, err := s.vault.Read(c.target())
	if err != nil || !validKey(string(key)) {
		clear(key)
		return config{}, nil, errUnavailable
	}
	return c, key, nil
}

// NewHTTPClient uses the platform TLS roots, no proxy and no private destination.
// DNS is resolved once per connection; the dial uses only the checked address.
func NewHTTPClient() *http.Client {
	return &http.Client{Transport: &http.Transport{
		DialContext:            dialPublic,
		TLSClientConfig:        &tls.Config{MinVersion: tls.VersionTLS12},
		TLSHandshakeTimeout:    5 * time.Second,
		DisableKeepAlives:      true,
		MaxResponseHeaderBytes: 32 * 1024,
	}}
}

func dialPublic(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, errUnavailable
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, errUnavailable
	}
	dialer := net.Dialer{Timeout: 4 * time.Second}
	for _, candidate := range ips {
		ip := candidate.Unmap()
		if !ip.IsGlobalUnicast() || ip.IsPrivate() || sharedAddress.Contains(ip) || benchmarkAddress.Contains(ip) || (ip.Is6() && !globalIPv6.Contains(ip)) {
			continue
		}
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
	}
	return nil, errUnavailable
}
