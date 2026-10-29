package console

import (
	"bytes"
	"strings"
	"testing"
)

func TestLevelFiltering(t *testing.T) {
	var buf bytes.Buffer
	log := New(&buf, false)
	log.Debug("debug line")
	log.Info("info line", "url", "http://127.0.0.1:1")
	if strings.Contains(buf.String(), "debug line") {
		t.Errorf("Debug must be hidden without -verbose, got:\n%s", buf.String())
	}
	if !strings.Contains(buf.String(), "info line") {
		t.Errorf("Info must always be visible, got:\n%s", buf.String())
	}
	if !strings.Contains(buf.String(), `url=http://127.0.0.1:1`) {
		t.Errorf("attributes must be logged as key=value, got:\n%s", buf.String())
	}

	buf.Reset()
	verbose := New(&buf, true)
	verbose.Debug("debug line")
	if !strings.Contains(buf.String(), "debug line") {
		t.Errorf("-verbose must show Debug, got:\n%s", buf.String())
	}
}

func TestWarnAndErrorAreVisible(t *testing.T) {
	var buf bytes.Buffer
	log := New(&buf, false)
	log.Warn("rejected foreign Host", "host", "evil.example")
	log.Error("handler panic", "panic", "boom")
	out := buf.String()
	if !strings.Contains(out, "rejected foreign Host") || !strings.Contains(out, "host=evil.example") {
		t.Errorf("Warn output = %q", out)
	}
	if !strings.Contains(out, "handler panic") || !strings.Contains(out, "panic=boom") {
		t.Errorf("Error output = %q", out)
	}
}

// Stderr must not panic when the app has no console (Explorer launch).
func TestStderrUsable(t *testing.T) {
	if Stderr(false) == nil || Stderr(true) == nil {
		t.Error("Stderr must return a logger")
	}
}
