package provider

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var (
	errCodexMissing = errors.New("找不到可用的 Codex 命令行，请安装或更新 Codex 并确认 codex.exe 在 PATH 中。")
	errCodexLogin   = errors.New("请先在 Codex 中使用 ChatGPT 登录，再重新确认发送。")
	errCodexInput   = errors.New("Codex 未确认使用本次照片，已保留上一次生成结果。")
	codexServerName = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
)

// CodexImage invokes the installed Codex App Server. It never handles its credentials.
type CodexImage struct {
	// Command replaces the App Server process in the isolated desktop test build.
	Command func(context.Context) (*exec.Cmd, error)
}

func (c CodexImage) Edit(ctx context.Context, preset, encoded string) ([]byte, error) {
	prompt := imagePrompt(preset)
	reference, _, _, ok := cleanPNG(encoded, 1024, maxFacePNG)
	if prompt == "" || !ok {
		return nil, errImageUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()
	dir, err := os.MkdirTemp("", "makeupmirror-codex-")
	if err != nil {
		return nil, errImageUnavailable
	}
	defer os.RemoveAll(dir)
	dir, err = filepath.EvalSymlinks(dir)
	if err != nil {
		return nil, errImageUnavailable
	}
	photo := filepath.Join(dir, "reference.png")
	if os.WriteFile(photo, reference, 0600) != nil {
		return nil, errImageUnavailable
	}
	command := c.Command
	if command == nil {
		command = func(ctx context.Context) (*exec.Cmd, error) { return codexCommand(ctx, dir) }
	}
	cmd, err := command(ctx)
	if err != nil {
		return nil, errCodexMissing
	}
	cmd.Dir = dir
	data, err := codexTurn(cmd, photo, prompt, sha256.Sum256(reference))
	if ctx.Err() != nil {
		return nil, errors.New("本次 Codex 生图已取消或超时。")
	}
	return data, err
}

func codexCommand(ctx context.Context, dir string) (*exec.Cmd, error) {
	path, err := exec.LookPath("codex.exe")
	if err != nil {
		return nil, err
	}
	list := exec.CommandContext(ctx, path, "mcp", "list", "--json", "--disable", "plugins")
	hideCodexWindow(list)
	list.Dir = dir
	raw, err := list.Output()
	if err != nil {
		return nil, err
	}
	var servers []struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(raw, &servers); err != nil {
		return nil, err
	}
	args := []string{
		"app-server", "--listen", "stdio://",
		"-c", `forced_login_method="chatgpt"`,
		"-c", `chatgpt_base_url="https://chatgpt.com/backend-api/"`,
		"-c", `openai_base_url="https://chatgpt.com/backend-api/codex"`,
		"-c", `web_search="disabled"`,
		"-c", "project_doc_max_bytes=0",
		"-c", "analytics.enabled=false",
		"--enable", "image_generation",
		"--disable", "shell_tool",
		"--disable", "hooks",
		"--disable", "plugins",
		"--disable", "apps",
		"--disable", "browser_use",
		"--disable", "in_app_browser",
		"--disable", "multi_agent",
		"--disable", "memories",
	}
	for _, server := range servers {
		if !codexServerName.MatchString(server.Name) {
			return nil, errCodexMissing
		}
		args = append(args, "-c", "mcp_servers."+server.Name+".enabled=false")
	}
	cmd := exec.CommandContext(ctx, path, args...)
	hideCodexWindow(cmd)
	return cmd, nil
}

type codexMessage struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  json.RawMessage `json:"error,omitempty"`
}

type codexRPC struct {
	out *bufio.Scanner
	in  *json.Encoder
	id  int
}

func (r *codexRPC) next() (codexMessage, error) {
	for r.out.Scan() {
		var msg codexMessage
		if json.Unmarshal(r.out.Bytes(), &msg) != nil {
			break
		}
		if len(msg.ID) != 0 && msg.Method != "" {
			if r.in.Encode(codexMessage{
				ID: msg.ID, Error: json.RawMessage(`{"code":-32601,"message":"Unsupported request"}`),
			}) != nil {
				break
			}
			continue
		}
		return msg, nil
	}
	return codexMessage{}, errImageUnavailable
}

func (r *codexRPC) request(method string, params any, receive func(codexMessage) error, target any) error {
	r.id++
	if r.in.Encode(map[string]any{"id": r.id, "method": method, "params": params}) != nil {
		return errImageUnavailable
	}
	for {
		msg, err := r.next()
		if err != nil {
			return err
		}
		var id int
		if len(msg.ID) != 0 && json.Unmarshal(msg.ID, &id) == nil && id == r.id {
			if len(msg.Error) != 0 || target != nil && json.Unmarshal(msg.Result, target) != nil {
				return errImageUnavailable
			}
			return nil
		}
		if receive != nil {
			if err := receive(msg); err != nil {
				return err
			}
		}
	}
}

func codexTurn(cmd *exec.Cmd, photo, prompt string, digest [32]byte) ([]byte, error) {
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, errImageUnavailable
	}
	defer in.Close()
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, errImageUnavailable
	}
	defer out.Close()
	if cmd.Start() != nil {
		return nil, errCodexMissing
	}
	defer func() {
		_ = in.Close()
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()
	rpc := codexRPC{in: json.NewEncoder(in), out: bufio.NewScanner(out)}
	rpc.out.Buffer(make([]byte, 64*1024), maxImageResponse)
	if rpc.request("initialize", map[string]any{
		"clientInfo": map[string]string{"name": "makeupmirror", "title": "MakeupMirror", "version": "0.1.0"},
	}, nil, nil) != nil || rpc.in.Encode(codexMessage{Method: "initialized"}) != nil {
		return nil, errImageUnavailable
	}
	var account struct {
		Account struct{ Type string }
	}
	if err := rpc.request("account/read", map[string]bool{"refreshToken": false}, nil, &account); err != nil {
		return nil, err
	}
	if account.Account.Type != "chatgpt" {
		return nil, errCodexLogin
	}
	var start struct {
		Thread struct{ ID string }
	}
	const instructions = "You are a makeup photo editor. Only use the built-in image generation tool. Edit the single supplied local reference PNG with the requested makeup. Do not use any other tool or context. Generate one PNG."
	if rpc.request("thread/start", map[string]any{
		"cwd": cmd.Dir, "ephemeral": true, "approvalPolicy": "never", "sandbox": "read-only",
		"modelProvider": "openai", "developerInstructions": instructions,
	}, nil, &start) != nil || start.Thread.ID == "" {
		return nil, errImageUnavailable
	}
	return codexEditTurn(&rpc, start.Thread.ID, photo, prompt, hex.EncodeToString(digest[:]))
}

func codexEditTurn(rpc *codexRPC, thread, photo, prompt, digest string) ([]byte, error) {
	var started struct {
		Turn struct{ ID string }
	}
	var result []byte
	var resultErr error
	var complete bool
	var seenTurn string
	receive := func(msg codexMessage) error {
		if msg.Method != "item/completed" && msg.Method != "turn/completed" {
			return nil
		}
		var params struct {
			ThreadID string
			TurnID   string
			Turn     struct{ ID, Status string }
			Item     struct {
				Type, Status, Result string
				InputImages          []struct{ Path, SHA256 string }
			}
		}
		if json.Unmarshal(msg.Params, &params) != nil || params.ThreadID != thread {
			return nil
		}
		turn := params.TurnID
		if msg.Method == "turn/completed" {
			turn = params.Turn.ID
		}
		if turn == "" || started.Turn.ID != "" && turn != started.Turn.ID {
			return nil
		}
		if seenTurn != "" && seenTurn != turn {
			return errImageUnavailable
		}
		seenTurn = turn
		if msg.Method == "turn/completed" {
			if params.Turn.Status != "completed" {
				return errImageUnavailable
			}
			complete = true
		} else if item := params.Item; item.Type == "imageGeneration" && item.Status == "completed" {
			if result != nil || resultErr != nil {
				return errImageResponse
			}
			if len(item.InputImages) != 1 || !strings.EqualFold(filepath.Clean(item.InputImages[0].Path), photo) ||
				item.InputImages[0].SHA256 != digest {
				resultErr = errCodexInput
				return nil
			}
			data, _, _, ok := cleanPNG(strings.TrimPrefix(item.Result, "data:image/png;base64,"), 2048, maxImagePNG)
			if !ok {
				resultErr = errImageResponse
			} else {
				result = data
			}
		}
		return nil
	}
	err := rpc.request("turn/start", map[string]any{
		"threadId": thread,
		"input": []map[string]string{
			{"type": "localImage", "path": photo},
			{"type": "text", "text": prompt + " Use the attached reference.png as the image input to your built-in image generation tool."},
		},
	}, receive, &started)
	if err != nil {
		return nil, err
	}
	if started.Turn.ID == "" || seenTurn != "" && seenTurn != started.Turn.ID {
		return nil, errImageUnavailable
	}
	for !complete {
		msg, err := rpc.next()
		if err != nil {
			return nil, err
		}
		if err := receive(msg); err != nil {
			return nil, err
		}
	}
	if resultErr != nil {
		return nil, resultErr
	}
	if result == nil {
		return nil, errImageResponse
	}
	return result, nil
}
