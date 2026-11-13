package provider

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"time"
)

const maxImagePNG = 16 * 1024 * 1024
const maxReferencePNG = 5 * 1024 * 1024
const maxImageResponse = 24 * 1024 * 1024

var (
	errImageUnavailable = errors.New("生成失败，可继续查看原图或上一次生成结果。")
	errImageResponse    = errors.New("供应商未返回有效的 PNG，已保留上一次生成结果。")
	errImageConsent     = errors.New("生图设置已变化，请重新确认发送。")
	errImageConnection  = errors.New("无法连接生图供应商，请检查网络或代理。")
	errImageTimeout     = errors.New("等待生图供应商超时，可继续查看上一次结果。")
)

func imagePrompt(preset string) string {
	var style string
	switch preset {
	case "daily-rose":
		style = "日常豆沙：低饱和豆沙口红、柔粉腮红、柔棕眼影。"
	case "photo-peach":
		style = "蜜桃暖妆：蜜桃口红、暖桃色腮红、暖棕眼影。"
	case "party-berry":
		style = "莓果夜妆：莓果口红、莓粉腮红、烟紫眼影。"
	default:
		return ""
	}
	return "仅调整照片中人物的妆容：" + style + "尽量保留人物身份、脸型、五官、表情、光线和背景；不要添加文字。"
}

// EditImage sends one bounded, metadata-free photo and accepts only inline PNG.
func (s *Store) EditImage(ctx context.Context, client *http.Client, endpoint, model, preset, encoded string) ([]byte, error) {
	prompt := imagePrompt(preset)
	if prompt == "" || client == nil || s.suffix != "/images/edits" {
		return nil, errImageUnavailable
	}
	c, key, err := s.credentials()
	if err != nil {
		return nil, errors.New("无法读取生图密钥，请重新检查供应商设置。")
	}
	defer clear(key)
	if c.Endpoint != endpoint || c.Model != model {
		return nil, errImageConsent
	}
	reference, w, h, ok := cleanPNG(encoded, 1024, maxReferencePNG)
	if !ok {
		return nil, errImageUnavailable
	}
	size := "1024x1024"
	switch {
	case w < h:
		size = "1024x1536"
	case w > h:
		size = "1536x1024"
	}

	var payload bytes.Buffer
	form := multipart.NewWriter(&payload)
	fields := [][2]string{{"model", c.Model}, {"prompt", prompt}, {"n", "1"}, {"size", size}, {"output_format", "png"}}
	imageField := "image[]"
	if endpointURL, err := url.Parse(c.Endpoint); err == nil && isMicuImage(endpointURL) {
		imageField = "image"
		fields = append(fields, [2]string{"quality", "low"})
	}
	for _, field := range fields {
		if form.WriteField(field[0], field[1]) != nil {
			return nil, errImageUnavailable
		}
	}
	part, err := form.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": {fmt.Sprintf(`form-data; name="%s"; filename="reference.png"`, imageField)},
		"Content-Type":        {"image/png"},
	})
	if err != nil {
		return nil, errImageUnavailable
	}
	if _, err := part.Write(reference); err != nil || form.Close() != nil {
		return nil, errImageUnavailable
	}

	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint, &payload)
	if err != nil {
		return nil, errImageUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+string(key))
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	noRedirect := *client
	noRedirect.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := noRedirect.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, errImageTimeout
		}
		if errors.Is(err, context.Canceled) {
			return nil, errors.New("本次生图已取消。")
		}
		return nil, errImageConnection
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		switch response.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return nil, errors.New("生图供应商拒绝访问，请检查密钥和模型权限。")
		case http.StatusTooManyRequests:
			return nil, errors.New("生图供应商限流，请稍后手动重试。")
		case http.StatusPaymentRequired:
			return nil, errors.New("生图供应商提示余额或配额不足，请检查账户。")
		default:
			return nil, fmt.Errorf("生图供应商返回 HTTP %d，请检查接口和模型。", response.StatusCode)
		}
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxImageResponse+1))
	if errors.Is(err, context.DeadlineExceeded) {
		return nil, errImageTimeout
	}
	var result struct {
		Data []struct {
			PNG string `json:"b64_json"`
		} `json:"data"`
	}
	if err != nil || len(body) > maxImageResponse || json.Unmarshal(body, &result) != nil || len(result.Data) != 1 {
		return nil, errImageResponse
	}
	image, _, _, ok := cleanPNG(result.Data[0].PNG, 2048, maxImagePNG)
	if !ok {
		return nil, errImageResponse
	}
	return image, nil
}

func cleanPNG(encoded string, maxSide, maxBytes int) ([]byte, int, int, bool) {
	if len(encoded) == 0 || len(encoded) > base64.StdEncoding.EncodedLen(maxBytes) {
		return nil, 0, 0, false
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(data) > maxBytes {
		return nil, 0, 0, false
	}
	info, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil || min(info.Width, info.Height) < 1 || max(info.Width, info.Height) > maxSide {
		return nil, 0, 0, false
	}
	image, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, 0, 0, false
	}
	var clean bytes.Buffer
	if png.Encode(&clean, image) != nil || clean.Len() > maxBytes {
		return nil, 0, 0, false
	}
	return clean.Bytes(), info.Width, info.Height, true
}
