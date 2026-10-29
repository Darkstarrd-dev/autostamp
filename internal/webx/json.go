// Package webx holds the tiny JSON envelope shared by every /api handler and by
// the middleware's own error responses.
package webx

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

// Envelope is the single JSON shape every endpoint uses.
//
// data and error are mutually exclusive; ok is explicit so the front-end can
// branch without sniffing "is there an error key".
type Envelope struct {
	OK    bool   `json:"ok"`
	Data  any    `json:"data,omitempty"`
	Code  string `json:"code,omitempty"`
	Error string `json:"error,omitempty"`
}

// OK writes a 200 success envelope.
func OK(w http.ResponseWriter, data any) {
	write(w, http.StatusOK, Envelope{OK: true, Data: data})
}

// Created writes a 201 success envelope.
func Created(w http.ResponseWriter, data any) {
	write(w, http.StatusCreated, Envelope{OK: true, Data: data})
}

// Fail writes an error envelope with a stable machine-readable code plus a
// human-readable message the UI can show directly (i18n happens on the client
// for known codes; the message is the fallback text).
func Fail(w http.ResponseWriter, status int, code, message string) {
	write(w, status, Envelope{OK: false, Code: code, Error: message})
}

// FailErr maps a domain error to an envelope, defaulting to 500.
func FailErr(w http.ResponseWriter, status int, fallbackCode string, err error) {
	Fail(w, status, fallbackCode, err.Error())
}

func write(w http.ResponseWriter, status int, e Envelope) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(e); err != nil {
		// The status line is already sent; nothing better than logging here.
		return
	}
}

// DecodeJSON reads a JSON body into dst with a size cap. The cap is a second
// line of defence: the route-level http.MaxBytesHandler already wraps the
// request body, but a handler that forgets it still cannot be OOM'd.
func DecodeJSON(r *http.Request, dst any, maxBytes int64) error {
	if maxBytes > 0 {
		r.Body = http.MaxBytesReader(nil, r.Body, maxBytes)
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			return errors.New("请求体为空")
		}
		return err
	}
	return nil
}
