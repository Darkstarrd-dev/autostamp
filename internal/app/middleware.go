package app

import (
	"compress/gzip"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"autostamp/internal/webx"
)

// middleware chains the request pipeline in one place:
//
//	recoverLog -> requestLog -> host/origin guard -> gzip
//
// The Host check is always on (that alone blocks DNS-rebinding, AGENTS §5.11);
// the Origin check runs only when strict is true, because P7 finishes that
// enforcement and the front-end must first learn to send the right Origin
// ("先埋开关" in the plan).
func middleware(next http.Handler, log *slog.Logger, allowedHost []string, strict bool) http.Handler {
	allowed := make(map[string]bool, len(allowedHost))
	for _, h := range allowedHost {
		allowed[strings.ToLower(h)] = true
	}
	h := next
	h = recoverLog(h, log)
	h = requestLog(h, log)
	h = hostGuard(h, log, allowed, strict)
	h = gzipMiddleware(h)
	return h
}

func recoverLog(next http.Handler, log *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Error("handler panic", "path", r.URL.Path, "panic", rec, "stack", string(debug.Stack()))
				webx.Fail(w, http.StatusInternalServerError, "internal_error", "服务器内部错误，详情见日志")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func requestLog(next http.Handler, log *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		// Static assets are noisy (vendor cmaps/wasm are dozens of small files);
		// keep them at debug so the useful lines stay visible.
		lvl := slog.LevelInfo
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			lvl = slog.LevelDebug
		}
		log.LogAttrs(r.Context(), lvl, "http",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", rec.status),
			slog.Int("bytes", int(rec.bytes)),
			slog.String("dur", time.Since(start).Round(time.Millisecond).String()),
		)
	})
}

// hostGuard verifies Host and, when strict, Origin.
//
// A foreign Host is the DNS-rebinding vector: an attacker's domain can resolve
// to 127.0.0.1 and then reach this server from the user's browser. Verifying
// Host closes that. Verifying Origin additionally closes "a random web page
// POSTs to your local app", which is why P7 flips strict on.
func hostGuard(next http.Handler, log *slog.Logger, allowed map[string]bool, strict bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hostAllowed(r.Host, allowed) {
			log.Warn("rejected foreign Host", "host", r.Host, "path", r.URL.Path)
			webx.Fail(w, http.StatusMisdirectedRequest, "bad_host", "Host 头不是本机地址")
			return
		}
		if strict && r.Method != http.MethodGet && r.Method != http.MethodHead {
			if o := r.Header.Get("Origin"); o != "" && !hostAllowed(originHost(o), allowed) {
				log.Warn("rejected foreign Origin", "origin", o, "path", r.URL.Path)
				webx.Fail(w, http.StatusForbidden, "bad_origin", "Origin 不是本机应用")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// hostAllowed matches a bare host or host:port against the allow list.
func hostAllowed(host string, allowed map[string]bool) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if allowed[host] {
		return true
	}
	if i := strings.LastIndex(host, ":"); i > 0 && !strings.HasSuffix(host, "]") {
		return allowed[host[:i]]
	}
	return false
}

// originHost strips the scheme from an Origin header value.
func originHost(origin string) string {
	u := strings.ToLower(strings.TrimSpace(origin))
	if i := strings.Index(u, "://"); i >= 0 {
		u = u[i+3:]
	}
	return u
}

// gzipExt lists the extensions worth gzipping. pdf.js ships .mjs/.json/.map and
// the app serves .html/.css; cmaps, wasm, PNG and PDF are already deflated or
// binary, so recompressing them costs CPU for no gain (AGENTS §4 协商 +
// 跳过已压缩类型).
var gzipExt = []string{".html", ".js", ".mjs", ".css", ".json", ".txt", ".map", ".svg"}

func compressible(path string) bool {
	if path == "" || path == "/" {
		return true
	}
	for _, ext := range gzipExt {
		if strings.HasSuffix(path, ext) {
			return true
		}
	}
	return false
}

func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") || !compressible(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		gw := gzip.NewWriter(w)
		next.ServeHTTP(&gzipWriter{ResponseWriter: w, gw: gw}, r)
		// The stream must be closed for the body to be valid; the header was
		// already sent, so a close error has nowhere to go but the log line.
		if err := gw.Close(); err != nil {
			slog.Default().Warn("gzip close failed", "path", r.URL.Path, "err", err)
		}
	})
}

// gzipWriter tees writes into the gzip stream.
type gzipWriter struct {
	http.ResponseWriter
	gw *gzip.Writer
}

func (g *gzipWriter) Write(p []byte) (int, error) { return g.gw.Write(p) }

// statusWriter records the status and byte count for the access log.
type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(p []byte) (int, error) {
	n, err := w.ResponseWriter.Write(p)
	w.bytes += int64(n)
	return n, err
}

// Flush keeps SSE (P6 progress stream) working through this layer.
func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
