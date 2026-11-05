// The backend-terminal channel (HD16): the UI's show/hide button reads the
// app's own log tail through this route. Everything comes from the in-memory
// ring (console.LogRing); nothing is re-parsed from stderr.

package api

import (
	"net/http"

	"autostamp/internal/console"
	"autostamp/internal/webx"
)

// logsPayload is the /api/logs envelope data.
type logsPayload struct {
	Lines []console.LogLine `json:"lines"`
	Next  int64             `json:"next"`
}

// handleLogs streams entries with seq greater than the "since" query param;
// the front-end polls while the panel is visible and passes the previous
// "next" back as the next "since".
func handleLogs(ring *console.LogRing) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		since := console.ParseSince(r.URL.Query().Get("since"))
		lines, next := ring.Since(since)
		webx.OK(w, logsPayload{Lines: lines, Next: next})
	}
}
