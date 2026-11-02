package pdfcore

import (
	"context"
	"fmt"

	"github.com/pdfcpu/pdfcpu/pkg/api"
)

// Validate re-checks a PDF this app produced (AGENTS §8: every write path must
// pass ValidateFile before the result becomes a session asset). The limits come
// from DefaultLimits so the writer and the reader agree on what we are willing
// to look at (FACTS §2.4: pdfcpu's own caps are far too wide for a local app).
//
// A validation failure is returned wrapped: the caller turns it into a
// contract code, and the message keeps pdfcpu's reason so the UI can show it.
func Validate(ctx context.Context, path string) error {
	if err := api.ValidateFile(ctx, path, DefaultLimits(), nil); err != nil {
		return fmt.Errorf("pdfcpu 校验失败: %w", err)
	}
	return nil
}
