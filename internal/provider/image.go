package provider

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"time"
)

const maxImagePNG = 16 * 1024 * 1024
const maxReferencePNG = 5 * 1024 * 1024
const maxImageResponse = 24 * 1024 * 1024

var (
	errImageUnavailable = errors.New("生成失败，可继续查看原图或上一次生成结果。")
	errImageResponse    = errors.New("供应商未返回有效的 PNG，已保留上一次生成结果。")
	errImageConsent     = errors.New("生图设置已变化，请重新确认发送。")
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
		return nil, errImageUnavailable
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
	for _, field := range [][2]string{{"model", c.Model}, {"prompt", prompt}, {"n", "1"}, {"size", size}, {"output_format", "png"}} {
		if form.WriteField(field[0], field[1]) != nil {
			return nil, errImageUnavailable
		}
	}
	part, err := form.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": {`form-data; name="image[]"; filename="reference.png"`},
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
		return nil, errImageUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, errImageUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxImageResponse+1))
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
