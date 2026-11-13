package provider_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"strings"
	"testing"

	"makeupmirror/internal/provider"
)

type imageTransport func(*http.Request) (*http.Response, error)

func (f imageTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestImageEditMicuWireFormat(t *testing.T) {
	const endpoint = "https://www.micuapi.ai/v1/images/edits"
	store := provider.NewImageStore(t.TempDir(), testVault{})
	const secret = "fixture-secret-not-for-display"
	if _, err := store.Save(provider.Input{Enabled: true, Endpoint: endpoint, Model: "gpt-image-2", Key: secret}); err != nil {
		t.Fatal(err)
	}
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	encoded := base64.StdEncoding.EncodeToString(b.Bytes())
	status := 200
	calls := 0
	client := &http.Client{Transport: imageTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != endpoint || r.Method != "POST" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL)
		}
		if r.Header.Get("Authorization") != "Bearer "+secret {
			t.Fatal("missing authorization")
		}
		if err := r.ParseMultipartForm(64 << 10); err != nil {
			t.Fatal(err)
		}
		file, _, err := r.FormFile("image")
		if err != nil {
			t.Fatalf("米醋需要 image 字段：%v", err)
		}
		file.Close()
		if len(r.MultipartForm.File) != 1 || r.FormValue("model") != "gpt-image-2" {
			t.Fatal("unexpected form")
		}
		if r.FormValue("quality") != "low" {
			t.Fatal("米醋参考预览应使用文档中的低质量档，减少等待")
		}
		data, _ := json.Marshal(map[string]any{"data": []map[string]string{{"b64_json": encoded}}})
		if status != 200 {
			data = []byte(secret)
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(bytes.NewReader(data)), Header: make(http.Header)}, nil
	})}
	if out, err := store.EditImage(context.Background(), client, endpoint, "gpt-image-2", "daily-rose", encoded); err != nil || len(out) == 0 {
		t.Fatalf("米醋改图失败：%v", err)
	}
	for _, tc := range []struct {
		status int
		text   string
	}{{401, "密钥"}, {429, "限流"}, {503, "503"}} {
		status = tc.status
		_, err := store.EditImage(context.Background(), client, endpoint, "gpt-image-2", "daily-rose", encoded)
		if err == nil || !strings.Contains(err.Error(), tc.text) || strings.Contains(err.Error(), secret) {
			t.Fatalf("状态 %d 的提示不正确：%v", status, err)
		}
	}
	if calls != 4 {
		t.Fatalf("不应重发请求：%d", calls)
	}
}
