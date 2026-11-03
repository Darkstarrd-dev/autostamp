package api

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// writeEncryptedPDF makes an AES-256 encrypted one-page document (the same
// recipe tools/verify/encfx uses) so the password vocabulary can be tested on a
// real encrypted file instead of a hand-made error string.
func writeEncryptedPDF(t *testing.T, userPW, ownerPW string) string {
	t.Helper()
	plain := writePDF(t, "plain-for-enc.pdf")
	out := filepath.Join(filepath.Dir(plain), "encrypted.pdf")
	conf := model.NewAESConfiguration(userPW, ownerPW, 256)
	conf.Permissions = model.PermissionsAll
	if err := api.EncryptFile(context.Background(), plain, out, conf); err != nil {
		t.Fatalf("encrypt fixture: %v", err)
	}
	if _, err := os.Stat(out); err != nil {
		t.Fatalf("encrypted fixture: %v", err)
	}
	return out
}

// TestOpenPasswordRoundTrip covers the FACTS §2.4 / §6 item that was UNVERIFIED:
// the single `pw` field has to work against an AES-256 document. Before this the
// password codes were only produced by hand-written error maps, so the real
// pdfcpu path was never exercised.
func TestOpenPasswordRoundTrip(t *testing.T) {
	mux, _, assets := newTestMux(t)
	owner := newSession(t)
	path := writeEncryptedPDF(t, "secret-open", "secret-owner")
	grant := grantPath(t, assets, path, owner)

	rec := openJSON(t, mux, `{"pathGrantId":"`+grant+`"}`, owner)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("open without a password = %d, want 400 body=%s", rec.Code, rec.Body.String())
	}
	if code := errorCode(t, rec); code != "password_required" {
		t.Errorf("code = %q, want password_required", code)
	}

	rec = openJSON(t, mux, `{"pathGrantId":"`+grant+`","pw":"wrong"}`, owner)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("open with a wrong password = %d, want 400", rec.Code)
	}
	if code := errorCode(t, rec); code != "password_invalid" {
		t.Errorf("code = %q, want password_invalid", code)
	}

	// The one-field vocabulary tries this as UserPW first, then OwnerPW (AGENTS
	// §6 api.open.pw): the user password must open the document.
	rec = openJSON(t, mux, `{"pathGrantId":"`+grant+`","pw":"secret-open"}`, owner)
	if rec.Code != http.StatusCreated {
		t.Fatalf("open with the user password = %d body=%s", rec.Code, rec.Body.String())
	}
	if data := dataOf(t, rec); data["pageCount"] != float64(1) {
		t.Errorf("pageCount = %v, want 1 page through the password channel", data["pageCount"])
	}

	// Owner-only: pdfcpu reports the owner password as an owner-required context,
	// and our single-field vocabulary covers both, so this must also open.
	rec = openJSON(t, mux, `{"pathGrantId":"`+grant+`","pw":"secret-owner"}`, owner)
	if rec.Code != http.StatusCreated {
		t.Fatalf("open with the owner password = %d body=%s", rec.Code, rec.Body.String())
	}
}
