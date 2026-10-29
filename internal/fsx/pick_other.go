//go:build !windows

package fsx

import "context"

// runPick has no dialog to show: AutoStamp carries no CGO dependency and no
// X11/Carbon bridge (AGENTS §2), so the route answers 501 pick_unsupported and
// the UI falls back to the path box.
func runPick(ctx context.Context, script string) ([]string, error) {
	return nil, ErrPickUnsupported
}
