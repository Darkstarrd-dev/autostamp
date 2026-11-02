package pdfcore

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// ParsePages resolves the contract's pages vocabulary (UI_SPEC §2:
// `all | none | <页号>[-<页号>][,...]`, 1 基) into a sorted, de-duplicated list
// of page numbers within pageCount.
//
// "all" selects every page, "none" selects nothing (a caller that wants no
// pages must say so — an empty string is an error, not a silent no-op, because
// the UI's default is a real range). Out-of-range numbers and reversed ranges
// report an error instead of clamping: a typo in the box would otherwise stamp
// the seal on the wrong pages.
func ParsePages(spec string, pageCount int) ([]int, error) {
	if pageCount < 1 {
		return nil, fmt.Errorf("文档没有可寻页的页面（共 %d 页）", pageCount)
	}
	s := strings.TrimSpace(spec)
	if s == "" {
		return nil, fmt.Errorf("pages 不能为空（用 all 表示全部页）")
	}
	if strings.EqualFold(s, "all") {
		out := make([]int, 0, pageCount)
		for i := 1; i <= pageCount; i++ {
			out = append(out, i)
		}
		return out, nil
	}
	if strings.EqualFold(s, "none") {
		return nil, nil
	}
	seen := map[int]bool{}
	for _, part := range strings.Split(s, ",") {
		p := strings.TrimSpace(part)
		if p == "" {
			return nil, fmt.Errorf("pages 词表出现空片段: %q", spec)
		}
		if strings.EqualFold(p, "all") || strings.EqualFold(p, "none") {
			return nil, fmt.Errorf("pages 里的 %q 只能单独使用（不能和页号混写）", p)
		}
		head, tail, hasRange := strings.Cut(p, "-")
		// A single number is the normal case; a range is `a-b`. Guard against
		// the sloppy `1-2-3` form rather than parsing "1-" and ignoring "-3".
		start, err := strconv.Atoi(strings.TrimSpace(head))
		if err != nil {
			return nil, fmt.Errorf("pages 片段 %q 不是页号", part)
		}
		end := start
		if hasRange {
			e, err := strconv.Atoi(strings.TrimSpace(tail))
			if err != nil {
				return nil, fmt.Errorf("pages 片段 %q 的区间末端不是页号", part)
			}
			end = e
		}
		if start < 1 || end < 1 {
			return nil, fmt.Errorf("pages 片段 %q: 页号从 1 开始", part)
		}
		if end < start {
			return nil, fmt.Errorf("pages 片段 %q: 区间末端比起点小", part)
		}
		if end > pageCount {
			return nil, fmt.Errorf("pages 片段 %q: 页 %d 超出文档共 %d 页", part, end, pageCount)
		}
		for n := start; n <= end; n++ {
			seen[n] = true
		}
	}
	out := make([]int, 0, len(seen))
	for n := range seen {
		out = append(out, n)
	}
	sort.Ints(out)
	return out, nil
}
