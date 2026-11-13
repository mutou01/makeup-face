package provider

import (
	"context"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
)

const micuEndpoint = "https://www.micuapi.ai/v1/images/edits"

func isMicuImage(u *url.URL) bool { return u.String() == micuEndpoint }

// NewImageHTTPClient honors an enabled loopback Windows proxy only for the
// documented Micu endpoint. Generic provider and explanation requests stay direct.
func NewImageHTTPClient() *http.Client {
	return newImageHTTPClient(systemImageProxy())
}

func loopbackProxy(setting, bypass, target string) (*url.URL, netip.Addr) {
	for _, rule := range strings.Split(strings.ToLower(bypass), ";") {
		if match, _ := path.Match(strings.TrimSpace(rule), target); match {
			return nil, netip.Addr{}
		}
	}
	value := strings.TrimSpace(setting)
	if strings.Contains(value, "=") {
		value = ""
		for _, part := range strings.Split(setting, ";") {
			key, address, ok := strings.Cut(part, "=")
			if ok && strings.EqualFold(strings.TrimSpace(key), "https") {
				value = strings.TrimSpace(address)
				break
			}
		}
	}
	if !strings.Contains(value, "://") {
		value = "http://" + value
	}
	proxy, err := url.Parse(value)
	if err != nil || proxy.Scheme != "http" || proxy.User != nil || proxy.Path != "" || proxy.RawQuery != "" || proxy.ForceQuery || proxy.Fragment != "" {
		return nil, netip.Addr{}
	}
	port, err := strconv.ParseUint(proxy.Port(), 10, 16)
	if err != nil || port == 0 {
		return nil, netip.Addr{}
	}
	host := proxy.Hostname()
	ip, err := netip.ParseAddr(host)
	switch {
	case strings.EqualFold(host, "localhost"):
		ip = netip.MustParseAddr("127.0.0.1")
	case err != nil || !ip.IsLoopback() || ip.Zone() != "":
		return nil, netip.Addr{}
	}
	return proxy, ip
}

func codexProxyEnvironment(env []string, setting, bypass string) []string {
	for _, entry := range env {
		key, _, _ := strings.Cut(entry, "=")
		if strings.EqualFold(key, "HTTPS_PROXY") || strings.EqualFold(key, "ALL_PROXY") {
			return env
		}
	}
	proxy, ip := loopbackProxy(setting, bypass, "chatgpt.com")
	if proxy == nil {
		return env
	}
	proxy.Host = net.JoinHostPort(ip.String(), proxy.Port())
	return append(env, "HTTPS_PROXY="+proxy.String())
}

func newImageHTTPClient(setting, bypass string) *http.Client {
	client := NewHTTPClient()
	proxy, ip := loopbackProxy(setting, bypass, "www.micuapi.ai")
	if proxy == nil {
		return client
	}
	transport := client.Transport.(*http.Transport)
	transport.Proxy = func(r *http.Request) (*url.URL, error) {
		if isMicuImage(r.URL) {
			return proxy, nil
		}
		return nil, nil
	}
	dialer := net.Dialer{Timeout: 4 * time.Second}
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		if strings.EqualFold(addr, proxy.Host) {
			return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), proxy.Port()))
		}
		return dialPublic(ctx, network, addr)
	}
	return client
}
