package provider_test

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"makeupmirror/internal/provider"
)

type testVault map[string][]byte

func (v testVault) Read(target string) ([]byte, error) { return append([]byte(nil), v[target]...), nil }
func (v testVault) Write(target string, key []byte) error {
	v[target] = append([]byte(nil), key...)
	return nil
}
func (v testVault) Delete(target string) error { delete(v, target); return nil }

func TestExplainOverTLS(t *testing.T) {
	key := rand.Text()
	var requests = make(chan string, 2)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil || r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer "+key {
			t.Error("请求未使用预期的 HTTPS 地址和鉴权头")
		}
		var body struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Messages) != 2 {
			t.Error("请求消息无效")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		requests <- body.Messages[1].Content
		if strings.Contains(body.Messages[1].Content, `"scene":"party"`) {
			<-r.Context().Done()
			return
		}
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"测试说明"}}]}`)
	}))
	defer server.Close()
	store := provider.NewStore(t.TempDir(), testVault{})
	if _, err := store.Save(provider.Input{Enabled: true, Endpoint: "https://example.com/v1/chat/completions", Model: "fixture-model", Key: key}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Explain(context.Background(), server.Client(), provider.ExplainInput{Scene: "private free text", Look: "any", PresetID: "daily-rose"}); err == nil {
		t.Fatal("应拒绝未列入白名单的输入")
	}
	if len(requests) != 0 {
		t.Fatal("无效输入不应出站")
	}
	got, err := store.Explain(context.Background(), server.Client(), provider.ExplainInput{Scene: "daily", Look: "natural", PresetID: "daily-rose"})
	if err != nil || got != "测试说明" {
		t.Fatalf("有效 HTTPS 请求失败：%v", err)
	}
	if got := <-requests; got != `{"scene":"daily","look":"natural","preset_id":"daily-rose"}` {
		t.Error("发送的业务字段不符")
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := store.Explain(ctx, server.Client(), provider.ExplainInput{Scene: "party", Look: "any", PresetID: "party-berry"}); err == nil {
		t.Fatal("超时请求必须失败")
	}
}
