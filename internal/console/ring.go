// Ring keeps the recent log lines in memory so the UI's backend-terminal
// panel (HD16) can show them: the app starts without a visible console
// window, and the only channel the user had was stderr.

package console

import (
	"context"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"
)

// LogRingSize is how many lines the ring keeps (oldest dropped).
const LogRingSize = 400

// LogLine is one structured entry as the front-end sees it.
type LogLine struct {
	Seq     int64  `json:"seq"`
	Time    string `json:"time"`  // wall clock, HH:MM:SS
	Level   string `json:"level"` // INFO|WARN|ERROR|DEBUG
	Message string `json:"message"`
	Attrs   string `json:"attrs,omitempty"` // key=value joined (empty if none)
}

// LogRing is the bounded, thread-safe buffer behind /api/logs.
type LogRing struct {
	mu    sync.Mutex
	seq   int64
	lines []LogLine
}

// Append allocates the next sequence number and returns the stored entry.
// Entries past LogRingSize are dropped from the front.
func (r *LogRing) Append(level, message, attrs string) LogLine {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seq++
	line := LogLine{
		Seq:     r.seq,
		Time:    time.Now().Format("15:04:05"),
		Level:   level,
		Message: message,
		Attrs:   attrs,
	}
	r.lines = append(r.lines, line)
	if over := len(r.lines) - LogRingSize; over > 0 {
		// Keep the tail slice so consumers can still ask "since <dropped>".
		keep := make([]LogLine, len(r.lines)-over)
		copy(keep, r.lines[over:])
		r.lines = keep
	}
	return line
}

// Since returns every buffered entry with Seq > since, plus the highest seen
// sequence (a later poll passes that back as "since").
func (r *LogRing) Since(since int64) ([]LogLine, int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]LogLine, 0, len(r.lines))
	for _, l := range r.lines {
		if l.Seq > since {
			out = append(out, l)
		}
	}
	return out, r.seq
}

// ringHandler fans every record out to two slog handlers: the stderr text
// handler (unchanged behaviour) and the in-memory ring.
type ringHandler struct {
	base  slog.Handler
	ring  *LogRing
	attrs []slog.Attr // WithAttrs accumulation
}

func (h *ringHandler) Enabled(ctx context.Context, l slog.Level) bool { return h.base.Enabled(ctx, l) }

func (h *ringHandler) Handle(ctx context.Context, rec slog.Record) error {
	if err := h.base.Handle(ctx, rec); err != nil {
		return err
	}
	var sb strings.Builder
	writeAttrs := func(a slog.Attr) {
		sb.WriteString(a.Key)
		sb.WriteString("=")
		sb.WriteString(a.Value.String())
		sb.WriteString(" ")
	}
	for _, a := range h.attrs {
		writeAttrs(a)
	}
	rec.Attrs(func(a slog.Attr) bool {
		writeAttrs(a)
		return true
	})
	h.ring.Append(rec.Level.String(), rec.Message, strings.TrimSpace(sb.String()))
	return nil
}

func (h *ringHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	clone := *h
	clone.attrs = append(append([]slog.Attr{}, h.attrs...), attrs...)
	clone.base = h.base.WithAttrs(attrs)
	return &clone
}

func (h *ringHandler) WithGroup(name string) slog.Handler {
	clone := *h
	clone.base = h.base.WithGroup(name)
	return &clone
}

// WithRing wraps the logger so every record also lands in the ring (the UI
// panel reads it through GET /api/logs).
func WithRing(l *slog.Logger, ring *LogRing) *slog.Logger {
	return slog.New(&ringHandler{base: l.Handler(), ring: ring})
}

// RingFrom returns the ring behind a logger made by WithRing, or nil.
func RingFrom(l *slog.Logger) *LogRing {
	if h, ok := l.Handler().(*ringHandler); ok {
		return h.ring
	}
	return nil
}

// ParseSince keeps the query parsing next to the type it decodes.
func ParseSince(v string) int64 {
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n < 0 {
		return 0
	}
	return n
}
