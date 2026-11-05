package console

import (
	"bytes"
	"strings"
	"testing"
)

// The ring must keep its tail window and hand out monotone sequence numbers:
// the /api/logs poller uses "since" to deduplicate, so a re-used seq would
// silently drop lines (HD16).
func TestRingSequencingAndSince(t *testing.T) {
	var r LogRing
	a := r.Append("INFO", "first", "")
	b := r.Append("WARN", "second", "host=x path=/api")
	if a.Seq != 1 || b.Seq != 2 {
		t.Fatalf("seq = %d,%d, want 1,2", a.Seq, b.Seq)
	}
	lines, next := r.Since(0)
	if len(lines) != 2 || next != 2 {
		t.Fatalf("Since(0) = %d lines next=%d", len(lines), next)
	}
	if lines[1].Attrs != "host=x path=/api" || lines[1].Level != "WARN" {
		t.Fatalf("entry = %+v", lines[1])
	}
	lines, next = r.Since(1)
	if len(lines) != 1 || lines[0].Seq != 2 || next != 2 {
		t.Fatalf("Since(1) = %+v next=%d", lines, next)
	}
	lines, next = r.Since(next)
	if len(lines) != 0 || next != 2 {
		t.Fatalf("since past-end = %+v next=%d", lines, next)
	}
}

// A ring past the cap must keep the newest LogRingSize entries (the console
// panel shows the tail, never the head).
func TestRingBounded(t *testing.T) {
	t.Helper()
	var r LogRing
	for i := 0; i < LogRingSize+5; i++ {
		r.Append("INFO", "line", "")
	}
	lines, next := r.Since(0)
	if len(lines) != LogRingSize {
		t.Fatalf("len = %d, want %d", len(lines), LogRingSize)
	}
	if next != LogRingSize+5 {
		t.Fatalf("next = %d, want %d", next, LogRingSize+5)
	}
	if lines[0].Seq != 6 {
		t.Fatalf("oldest kept seq = %d, want 6", lines[0].Seq)
	}
}

// WithRing must fan out: stderr keeps its text lines and the ring sees the
// structured record with attributes (what the UI panel renders).
func TestWithRingFansOut(t *testing.T) {
	t.Helper()
	var buf bytes.Buffer
	ring := &LogRing{}
	l := WithRing(New(&buf, false), ring)
	l.Info("hello", "n", 3)
	if !strings.Contains(buf.String(), "msg=hello n=3") {
		t.Fatalf("stderr sink = %q", buf.String())
	}
	lines, next := ring.Since(0)
	if next != 1 || len(lines) != 1 {
		t.Fatalf("ring = %+v next=%d", lines, next)
	}
	if lines[0].Message != "hello" || lines[0].Attrs != "n=3" || lines[0].Level != "INFO" {
		t.Fatalf("entry = %+v", lines[0])
	}
}

func TestParseSince(t *testing.T) {
	if got := ParseSince(""); got != 0 {
		t.Errorf(`ParseSince("") = %d, want 0`, got)
	}
	if got := ParseSince("-4"); got != 0 {
		t.Errorf("ParseSince(-4) = %d, want 0", got)
	}
	if got := ParseSince("17"); got != 17 {
		t.Errorf("ParseSince(17) = %d, want 17", got)
	}
}
