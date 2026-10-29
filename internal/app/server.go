package app

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"time"
)

// Server wraps the loopback HTTP server (AGENTS §5.11: 只监听 127.0.0.1).
type Server struct {
	Log  *slog.Logger
	HTTP *http.Server
	ln   net.Listener
	url  string
}

// NewServer builds a server around h and applies the middleware chain
// (recoverLog -> requestLog -> host/origin guard -> gzip).
//
// strictOrigin is the P7 hardening switch (AGENTS §5.11 先埋开关): with false
// the guard only verifies the Host header, which already stops DNS-rebinding --
// the app has no auth of its own, so an unverified Origin would let any web
// page on the machine drive it.
func NewServer(ln net.Listener, h http.Handler, log *slog.Logger, port int, strictOrigin bool) *Server {
	guarded := middleware(h, log, loopbackHosts(port), strictOrigin)
	srv := &http.Server{
		Handler: guarded,
		// No WriteTimeout: P6 progress streams (SSE) stay open, so each handler
		// sets its own write deadline instead.
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	return &Server{
		Log:  log,
		HTTP: srv,
		ln:   ln,
		url:  LoopURL(port),
	}
}

// URL is the base URL the front-end and the window open.
func (s *Server) URL() string { return s.url }

// Port returns the bound loopback port.
func (s *Server) Port() int {
	if tc, ok := s.ln.Addr().(*net.TCPAddr); ok {
		return tc.Port
	}
	return 0
}

// loopbackHosts is the accepted Host list. Chromium and WebView2 send either
// "127.0.0.1:port" or "localhost:port", so both are allowed by construction.
func loopbackHosts(port int) []string {
	p := strconv.Itoa(port)
	return []string{"127.0.0.1:" + p, "localhost:" + p, "[::1]:" + p, "127.0.0.1", "localhost"}
}

// Serve runs the server until Shutdown is called (by Graceful or by a signal).
func (s *Server) Serve() error {
	s.Log.Info("listening", "url", s.url)
	err := s.HTTP.Serve(s.ln)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// Graceful stops accepting new requests and waits up to d for in-flight ones.
func (s *Server) Graceful(d time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	if err := s.HTTP.Shutdown(ctx); err != nil {
		s.Log.Warn("graceful shutdown failed", "err", err)
		return err
	}
	s.Log.Info("shutdown complete")
	return nil
}
