package app

import (
	"fmt"
	"net"
)

// ListenLoopback opens a listener on 127.0.0.1 with an OS-assigned free port
// (AGENTS §5.11: 随机端口 + loopback 是本地安全边界).
//
// The listener is returned, not just the port: holding it between "we know the
// URL" and "the server is up" avoids the self-connect race where another
// process grabs the port in between.
func ListenLoopback() (net.Listener, int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, 0, fmt.Errorf("listen 127.0.0.1:0: %w", err)
	}
	tc, ok := ln.Addr().(*net.TCPAddr)
	if !ok {
		ln.Close()
		return nil, 0, fmt.Errorf("unexpected listener address type %T", ln.Addr())
	}
	return ln, tc.Port, nil
}

// LoopURL builds the base URL the front-end and the window point at.
func LoopURL(port int) string { return fmt.Sprintf("http://127.0.0.1:%d", port) }
