package provider

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image/png"
	"io"
	"net/http"
	"time"

	"makeupmirror/internal/facemesh"
)

const maxFacePNG = 5 * 1024 * 1024
const maxFaceResponse = 256 * 1024

var errFaceUnavailable = errors.New("云端人脸分析未能完成，可继续查看原图。")
var errFaceResponse = errors.New("关键点响应不符合约定，可继续查看原图。")
var errFaceConsent = errors.New("分析设置已变化，请重新确认发送目标。")

// AnalyzeFace sends only a re-encoded work frame to the explicitly confirmed endpoint.
func (s *Store) AnalyzeFace(ctx context.Context, client *http.Client, endpoint, encoded string) (facemesh.Result, error) {
	var result facemesh.Result
	if len(encoded) > base64.StdEncoding.EncodedLen(maxFacePNG) || client == nil {
		return result, errFaceUnavailable
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(data) > maxFacePNG {
		return result, errFaceUnavailable
	}
	size, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil || size.Width < 1 || size.Height < 1 || max(size.Width, size.Height) > 1024 {
		return result, errFaceUnavailable
	}
	// Decode and re-encode to ensure even a malformed UI request cannot send original metadata.
	image, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return result, errFaceUnavailable
	}
	var clean bytes.Buffer
	if png.Encode(&clean, image) != nil || clean.Len() > maxFacePNG {
		return result, errFaceUnavailable
	}
	c, key, err := s.credentials()
	if err != nil {
		return result, errFaceUnavailable
	}
	defer clear(key)
	if s.suffix != "/face-mesh" || c.Endpoint != endpoint {
		return result, errFaceConsent
	}
	payload, err := json.Marshal(struct {
		Topology string `json:"topology"`
		Width    int    `json:"width"`
		Height   int    `json:"height"`
		Image    []byte `json:"image"`
	}{facemesh.Topology, size.Width, size.Height, clean.Bytes()})
	if err != nil {
		return result, errFaceUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint, bytes.NewReader(payload))
	if err != nil {
		return result, errFaceUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+string(key))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	bounded := *client
	bounded.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := bounded.Do(req)
	if err != nil {
		return result, errFaceUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return result, errFaceUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxFaceResponse+1))
	if err != nil || len(body) > maxFaceResponse || json.Unmarshal(body, &result) != nil || !result.Valid() || result.Width != size.Width || result.Height != size.Height {
		return facemesh.Result{}, errFaceResponse
	}
	return result, nil
}
