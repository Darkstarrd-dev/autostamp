package pdfcore

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// Blend modes (需求 4, AGENTS §5.3). pdfcpu's stamp layer never writes /BM —
// it only knows about CA/ca (FACTS §2.2: the /BM name appears solely in the
// validator whitelist), so this file injects the ExtGState entry itself.

// Blend is one of the 16 ExtGState blend modes the UI vocabulary exposes.
type Blend string

const (
	BlendNormal     Blend = "normal"
	BlendScreen     Blend = "screen"
	BlendLighten    Blend = "lighten"
	BlendColorDodge Blend = "color-dodge"
	BlendHardLight  Blend = "hard-light"
	BlendMultiply   Blend = "multiply"
	BlendDarken     Blend = "darken"
	BlendColorBurn  Blend = "color-burn"
	BlendOverlay    Blend = "overlay"
	BlendSoftLight  Blend = "soft-light"
	BlendDifference Blend = "difference"
	BlendExclusion  Blend = "exclusion"
	BlendHue        Blend = "hue"
	BlendSaturation Blend = "saturation"
	BlendColor      Blend = "color"
	BlendLuminosity Blend = "luminosity"
)

// blendPDF maps the UI vocabulary onto the PDF name the ExtGState /BM entry
// takes. Nothing here is invented: these are the 16 entries pdfcpu's own
// whitelist accepts (FACTS §2.2, validate/extGState.go:1142).
var blendPDF = map[Blend]string{
	BlendNormal:     "Normal",
	BlendScreen:     "Screen",
	BlendLighten:    "Lighten",
	BlendColorDodge: "ColorDodge",
	BlendHardLight:  "HardLight",
	BlendMultiply:   "Multiply",
	BlendDarken:     "Darken",
	BlendColorBurn:  "ColorBurn",
	BlendOverlay:    "Overlay",
	BlendSoftLight:  "SoftLight",
	BlendDifference: "Difference",
	BlendExclusion:  "Exclusion",
	BlendHue:        "Hue",
	BlendSaturation: "Saturation",
	BlendColor:      "Color",
	BlendLuminosity: "Luminosity",
}

// ParseBlend maps the vocabulary, "" -> normal (the panel default). Anything
// else is an error so the route answers 400 rather than writing a /BM the
// validator will reject.
func ParseBlend(s string) (Blend, error) {
	if s == "" {
		return BlendNormal, nil
	}
	b := Blend(strings.ToLower(s))
	if _, ok := blendPDF[b]; !ok {
		return "", fmt.Errorf("blend 必须是 16 种混合模式之一（%s），收到 %q", strings.Join(BlendNames(), " /"), s)
	}
	return b, nil
}

// BlendNames is the vocabulary in a stable order (used by error messages and
// the contract test).
func BlendNames() []string {
	names := make([]string, 0, len(blendPDF))
	for b := range blendPDF {
		names = append(names, string(b))
	}
	sort.Strings(names)
	return names
}

// PDFName is the ExtGState /BM value for this blend.
func (b Blend) PDFName() string {
	if n, ok := blendPDF[b]; ok {
		return n
	}
	return "Normal"
}

// Empty reports whether the blend needs no /BM entry at all (Normal is the
// initial value of the graphics state, so writing it is noise).
func (b Blend) Empty() bool { return b == BlendNormal || b == "" }

// BlendApplyNames patches /BM only on the named graphic states, which is how
// apply.go keeps one blend per instance: pdfcpu rejects mixed Opacity inside
// one AddWatermarksSliceMap pass (measured 2026-10-30: "inconsistent Opacity"),
// so every opacity+blend group is its own pass and its own ExtGState.
func BlendApplyNames(c context.Context, ctx *model.Context, pageNr int, b Blend, names map[string]bool) error {
	if b.Empty() {
		return nil
	}
	if len(names) == 0 {
		return fmt.Errorf("page %d: 印章通道未写入 ExtGState（%s 无法注入 /BM）", pageNr, b.PDFName())
	}
	pageDict, _, _, err := ctx.PageDict(c, pageNr, false)
	if err != nil {
		return fmt.Errorf("page %d: PageDict: %w", pageNr, err)
	}
	if pageDict == nil {
		return fmt.Errorf("page %d: missing dictionary", pageNr)
	}
	// matched > 0 means every requested state now carries this /BM: a shared
	// ExtGState object may already have it from an earlier page.
	_, _, err = blendStates(ctx, pageDict, pageNr, b, names)
	return err
}

// blendStates writes /BM on the restricted set of the page's ExtGState
// entries. patched counts the states this call wrote; matched counts the states
// it saw (already claimed or freshly written). Matching nothing is a caller
// bug — the requested states are not on this page.
//
// A state that already carries /BM is left alone: two instances on one page
// each own their own state, and re-writing a claimed one would silently change
// the appearance of the seal that claimed it. Pages that share one ExtGState
// object (measured 2026-10-30: a fixture whose pages all point at the same
// content stream and the same GS object) reach this path twice for the same
// object, which is why claimed is not an error.
func blendStates(ctx *model.Context, pageDict types.Dict, pageNr int, b Blend, restrict map[string]bool) (patched, matched int, err error) {
	pdfName := b.PDFName()
	if pageDict == nil {
		return 0, 0, fmt.Errorf("page %d: missing dictionary", pageNr)
	}
	resDict, err := pageResources(ctx, pageDict)
	if err != nil {
		return 0, 0, err
	}
	if resDict == nil {
		return 0, 0, fmt.Errorf("page %d: 印章通道没有 ExtGState 可注入 /BM", pageNr)
	}
	gsObj, found := resDict.Find("ExtGState")
	if !found {
		return 0, 0, fmt.Errorf("page %d: 印章通道没有 ExtGState 可注入 /BM", pageNr)
	}
	gsDict, err := ctx.DereferenceDict(gsObj)
	if err != nil {
		return 0, 0, fmt.Errorf("page %d: ExtGState: %w", pageNr, err)
	}
	for _, key := range sortedKeys(gsDict) {
		if !restrict[key] {
			continue
		}
		o, found := gsDict.Find(key)
		if !found {
			return patched, matched, fmt.Errorf("page %d: 印章状态 /%s 不在 Resources/ExtGState 里", pageNr, key)
		}
		d, err := ctx.DereferenceDict(o)
		if err != nil {
			return patched, matched, fmt.Errorf("page %d: ExtGState %s: %w", pageNr, key, err)
		}
		if d == nil {
			return patched, matched, fmt.Errorf("page %d: ExtGState %s 无法解析", pageNr, key)
		}
		matched++
		cur, ok := d.Find("BM")
		if !ok {
			d.InsertName("BM", pdfName)
			patched++
			continue
		}
		if n, isName := cur.(types.Name); !isName || n.Value() != pdfName {
			return patched, matched, fmt.Errorf("page %d: 印章状态 %s 已带其它混合模式（%v），不能改写成 %s", pageNr, key, cur, pdfName)
		}
		// already exactly right: another pass, or another page sharing this
		// very ExtGState object, wrote the same name first
		continue
	}
	if matched == 0 {
		return 0, 0, fmt.Errorf("page %d: 没有可注入 /BM 的图例状态（请求了 %s）", pageNr, pdfName)
	}
	return patched, matched, nil
}

// ExtGStateKeysOf reports the ExtGState resource names the page carries.
// apply.go uses it as the pass footprint: the names a pdfcpu pass adds are the
// graphic states that pass owns, which is also how pages that share one
// ExtGState object stay honest about it.
func ExtGStateKeysOf(c context.Context, ctx *model.Context, pageNr int) (map[string]bool, error) {
	pageDict, _, _, err := ctx.PageDict(c, pageNr, false)
	if err != nil {
		return nil, fmt.Errorf("page %d: PageDict: %w", pageNr, err)
	}
	if pageDict == nil {
		return nil, fmt.Errorf("page %d: missing dictionary", pageNr)
	}
	resDict, err := pageResources(ctx, pageDict)
	if err != nil || resDict == nil {
		return nil, err
	}
	gsObj, found := resDict.Find("ExtGState")
	if !found {
		return map[string]bool{}, nil
	}
	gsDict, err := ctx.DereferenceDict(gsObj)
	if err != nil {
		return nil, fmt.Errorf("page %d: ExtGState: %w", pageNr, err)
	}
	out := map[string]bool{}
	if gsDict != nil {
		for k := range gsDict {
			out[k] = true
		}
	}
	return out, nil
}

// StampGraphicStatesOf exports the stamp-state scan for apply.go's per-pass
// bookkeeping (it is the same scan stampGraphicStates does).
func StampGraphicStatesOf(c context.Context, ctx *model.Context, pageNr int) (map[string]bool, error) {
	pageDict, _, _, err := ctx.PageDict(c, pageNr, false)
	if err != nil {
		return nil, fmt.Errorf("page %d: PageDict: %w", pageNr, err)
	}
	if pageDict == nil {
		return nil, fmt.Errorf("page %d: missing dictionary", pageNr)
	}
	return stampGraphicStates(ctx, pageDict, pageNr)
}

// stampGraphicStates returns the ExtGState names the page's stamp/watermark
// artifacts reference, i.e. the graphic states pdfcpu's stamp layer inserted
// (the ones carrying the Artifact marked content with the Watermark subtype).
func stampGraphicStates(ctx *model.Context, pageDict types.Dict, pageNr int) (map[string]bool, error) {
	out := map[string]bool{}
	content, err := pageContentBytes(ctx, pageDict, pageNr)
	if err != nil {
		return nil, err
	}
	if err := scanArtifactGraphicStates(content, out); err != nil {
		return nil, err
	}
	return out, nil
}

// scanArtifactGraphicStates records every ExtGState name that pdfcpu's stamp
// layer used inside its own marked-content block ("/Name gs" inside the
// Artifact/Watermark block). The token walk is delimiter-aware on purpose:
// pdfcpu writes `>>BDC` with no space between the dict and the operator, and a
// whitespace-only split would glue those two tokens and miss the block
// (measured 2026-10-30 on a stamped one-page fixture).
func scanArtifactGraphicStates(content []byte, out map[string]bool) error {
	toks, err := tokenizeContent(content)
	if err != nil {
		return err
	}
	// markDepth tracks, innermost last, whether that marked-content block is
	// the stamp layer. Nested blocks inherit the outer answer, because the
	// stamp layer can wrap page content.
	var markDepth []bool
	// dictStart is the open-paren stack for dict literals; dictLast keeps the
	// text of the most recently *closed* top-level dict so a following BDC can
	// ask which tag it carries.
	var dictStart []int
	var dictLast string
	prev := ""
	for i, t := range toks {
		switch t.text {
		case "<<":
			dictStart = append(dictStart, t.start)
		case ">>":
			if len(dictStart) > 0 {
				s := dictStart[len(dictStart)-1]
				dictStart = dictStart[:len(dictStart)-1]
				if len(dictStart) == 0 {
					dictLast = string(content[s:t.start])
				}
			}
		case "BDC", "BMC":
			markDepth = append(markDepth, watermarkMarked(prev, dictLast, t.text))
		case "EMC":
			if len(markDepth) > 0 {
				markDepth = markDepth[:len(markDepth)-1]
			}
		default:
			if strings.HasPrefix(t.text, "/") && i+1 < len(toks) && toks[i+1].text == "gs" && inWatermarkMark(markDepth) {
				out[t.text[1:]] = true
			}
		}
		prev = t.text
	}
	return nil
}

// watermarkMarked reports whether a just-seen BDC/BMC carries the stamp
// layer's own tag. pdfcpu emits `/Artifact <</Subtype /Watermark /Type
// /Pagination >>BDC`: the token before the operator is the dict's `>>`, so the
// marker has to be looked for *inside* the dict body — the tag name itself sits
// before the dict. A bare BMC (no tag at all) is never the stamp layer.
func watermarkMarked(prev, dictLast, op string) bool {
	if op == "BMC" {
		return false
	}
	if prev == ">>" {
		return strings.Contains(dictLast, "/Subtype") && strings.Contains(dictLast, "/Watermark")
	}
	return prev == "/Artifact" || prev == "/Watermark"
}

func inWatermarkMark(depth []bool) bool {
	return len(depth) > 0 && depth[len(depth)-1]
}

// contentToken is one lexical token plus the byte offset it starts at.
type contentToken struct {
	text  string
	start int
}

// tokenizeContent splits a content stream into tokens. Delimiters are their
// own tokens (unlike a whitespace split), which is what makes `>>BDC`,
// `/GS0 gs` and `>> BDC` tokenize the same way.
func tokenizeContent(content []byte) ([]contentToken, error) {
	var out []contentToken
	i := 0
	for i < len(content) {
		c := content[i]
		if isSpace(c) {
			i++
			continue
		}
		switch c {
		case '%': // comment: to the end of the line
			for i < len(content) && content[i] != '\n' && content[i] != '\r' {
				i++
			}
			continue
		case '(':
			j, err := skipString(content, i)
			if err != nil {
				return nil, err
			}
			out = append(out, contentToken{text: string(content[i:j]), start: i})
			i = j
			continue
		case '<':
			if i+1 < len(content) && content[i+1] == '<' {
				out = append(out, contentToken{text: "<<", start: i})
				i += 2
				continue
			}
			j := i + 1
			for j < len(content) && content[j] != '>' {
				j++
			}
			if j >= len(content) {
				return nil, fmt.Errorf("unterminated hex string in content stream")
			}
			out = append(out, contentToken{text: string(content[i : j+1]), start: i})
			i = j + 1
			continue
		case '>':
			if i+1 < len(content) && content[i+1] == '>' {
				out = append(out, contentToken{text: ">>", start: i})
				i += 2
				continue
			}
			out = append(out, contentToken{text: ">", start: i})
			i++
			continue
		case '[', ']', '{', '}':
			out = append(out, contentToken{text: string(c), start: i})
			i++
			continue
		case '/':
			name, next, err := readName(content, i)
			if err != nil {
				return nil, err
			}
			out = append(out, contentToken{text: "/" + name, start: i})
			i = next
			continue
		}
		start := i
		for i < len(content) {
			c = content[i]
			if isSpace(c) || c == '/' || c == '(' || c == ')' || c == '<' || c == '>' || c == '[' || c == ']' || c == '{' || c == '}' {
				break
			}
			i++
		}
		if start == i {
			return nil, fmt.Errorf("content stream token empty at %d", start)
		}
		out = append(out, contentToken{text: string(content[start:i]), start: start})
	}
	return out, nil
}

func skipString(content []byte, i int) (int, error) {
	depth := 1
	i++
	for i < len(content) && depth > 0 {
		switch content[i] {
		case '\\':
			i += 2
			continue
		case '(':
			depth++
		case ')':
			depth--
		}
		i++
	}
	if depth > 0 {
		return 0, fmt.Errorf("unbalanced string literal in content stream")
	}
	return i, nil
}

func readName(content []byte, i int) (string, int, error) {
	i++ // skip '/'
	start := i
	for i < len(content) {
		c := content[i]
		if c == '/' || c == '(' || c == ')' || c == '<' || c == '>' || c == '[' || c == ']' || c == '{' || c == '}' || isSpace(c) {
			break
		}
		i++
	}
	if start == i {
		return "", 0, fmt.Errorf("empty name in content stream at %d", start)
	}
	return string(content[start:i]), i, nil
}

func isSpace(c byte) bool {
	return c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == '\f' || c == 0
}

// pageResources returns the page's own resource dict, inheriting from the page
// ancestors when the page leaves Resources out (the inheritance rule pdfcpu
// itself follows).
func pageResources(ctx *model.Context, pageDict types.Dict) (types.Dict, error) {
	if o, found := pageDict.Find("Resources"); found {
		d, err := ctx.DereferenceDict(o)
		if err != nil {
			return nil, fmt.Errorf("Resources: %w", err)
		}
		return d, nil
	}
	return nil, nil
}

// sortedKeys returns a dict's keys in a stable order so the patch (and any
// error message it produces) is deterministic.
func sortedKeys(d types.Dict) []string {
	keys := make([]string, 0, len(d))
	for k := range d {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// pageContentBytes returns the page's consolidated content bytes, inflated.
// XRefTable.PageContent is what a viewer sees; reading StreamDict.Content
// straight is wrong after a write + re-read, because the streams are then
// FlateDecode (measured 2026-10-30: the artifact scan found nothing at all on a
// re-read file, which is how this helper got pinned to pdfcpu's own path).
func pageContentBytes(ctx *model.Context, pageDict types.Dict, pageNr int) ([]byte, error) {
	b, err := ctx.PageContent(pageDict, pageNr)
	if err != nil && !errors.Is(err, model.ErrNoContent) {
		return nil, fmt.Errorf("page %d: 读取内容流失败: %w", pageNr, err)
	}
	return b, nil
}
