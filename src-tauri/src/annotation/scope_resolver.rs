use super::types::{ResolutionMode, Scope, ScopeKind, ScopeRange};

/// One-shot wrapper over [`ScopeResolveCtx`]. When resolving many scopes
/// against the same content, build one ctx and reuse it instead.
pub fn resolve_scope_range(
    content: &str,
    char_start: usize,
    scope: &Scope,
    lang: &str,
) -> Option<ScopeRange> {
    ScopeResolveCtx::new(content, lang).resolve_scope_range(char_start, scope)
}

/// Checkpointed UTF-16 ↔ byte offset map. Built once per document so repeated
/// conversions cost a binary search + a short char-walk instead of a prefix
/// scan from the start of the body. ASCII content needs no table: offsets are
/// identical in both encodings.
struct Utf16ByteMap {
    ascii: bool,
    /// `(utf16_offset, byte_offset)` sampled every `U16MAP_STRIDE` chars,
    /// always including `(0, 0)` and the end of the content.
    checkpoints: Vec<(u32, u32)>,
}

const U16MAP_STRIDE: usize = 1024;

impl Utf16ByteMap {
    fn new(content: &str) -> Self {
        if content.is_ascii() {
            return Self { ascii: true, checkpoints: Vec::new() };
        }
        let mut checkpoints = vec![(0u32, 0u32)];
        let mut utf16_acc = 0usize;
        for (count, (byte_idx, ch)) in content.char_indices().enumerate() {
            if count > 0 && count % U16MAP_STRIDE == 0 {
                checkpoints.push((utf16_acc as u32, byte_idx as u32));
            }
            utf16_acc += ch.len_utf16();
        }
        checkpoints.push((utf16_acc as u32, content.len() as u32));
        Self { ascii: false, checkpoints }
    }

    /// Same contract as `utf16_to_byte`: byte index of the first char at or
    /// past `utf16_offset` (offsets past the end clamp to `content.len()`).
    fn to_byte(&self, content: &str, utf16_offset: usize) -> usize {
        if self.ascii {
            return utf16_offset.min(content.len());
        }
        let idx = self
            .checkpoints
            .partition_point(|&(u, _)| (u as usize) <= utf16_offset)
            - 1;
        let (utf16_base, byte_base) = self.checkpoints[idx];
        let mut utf16_acc = utf16_base as usize;
        let byte_base = byte_base as usize;
        for (byte_idx, ch) in content[byte_base..].char_indices() {
            if utf16_acc >= utf16_offset {
                return byte_base + byte_idx;
            }
            utf16_acc += ch.len_utf16();
        }
        content.len()
    }

    /// Same contract as `utf16_len(&content[..byte_offset])`; `byte_offset`
    /// must be a char boundary.
    fn to_u16(&self, content: &str, byte_offset: usize) -> usize {
        if self.ascii {
            return byte_offset.min(content.len());
        }
        let idx = self
            .checkpoints
            .partition_point(|&(_, b)| (b as usize) <= byte_offset)
            - 1;
        let (utf16_base, byte_base) = self.checkpoints[idx];
        let mut utf16_acc = utf16_base as usize;
        for ch in content[byte_base as usize..byte_offset].chars() {
            utf16_acc += ch.len_utf16();
        }
        utf16_acc
    }
}

/// Byte span of one raw sentence segment in the document, as returned by
/// `sentencex::segment` (untrimmed; spans partition the content).
struct RawSeg {
    raw_start: usize,
    raw_end: usize,
}

/// Per-document resolution context: caches the UTF-16↔byte offset map and the
/// full-body sentence segmentation so resolving many annotations against the
/// same content pays segmentation and offset scanning once instead of per
/// annotation. Build one per file and resolve all of its annotations
/// through it; the one-shot free functions below wrap it for single calls.
pub struct ScopeResolveCtx<'a> {
    content: &'a str,
    lang: &'a str,
    u16map: std::cell::OnceCell<Utf16ByteMap>,
    segs: std::cell::OnceCell<Vec<RawSeg>>,
}

impl<'a> ScopeResolveCtx<'a> {
    pub fn new(content: &'a str, lang: &'a str) -> Self {
        Self {
            content,
            lang,
            u16map: std::cell::OnceCell::new(),
            segs: std::cell::OnceCell::new(),
        }
    }

    fn u16map(&self) -> &Utf16ByteMap {
        self.u16map.get_or_init(|| Utf16ByteMap::new(self.content))
    }

    fn to_byte(&self, utf16_offset: usize) -> usize {
        self.u16map().to_byte(self.content, utf16_offset)
    }

    fn to_u16(&self, byte_offset: usize) -> usize {
        self.u16map().to_u16(self.content, byte_offset)
    }

    /// Full-body sentence segmentation, computed lazily on first use.
    /// `sentencex::segment` returns sentence segments as subslices of the
    /// input, so each span is recovered by pointer offset. Paragraph
    /// separators are emitted as a static `"\n\n"` (sentencex 0.1.23), not a
    /// subslice — those are dropped here, leaving whitespace-only gaps
    /// between spans. That matches `split_sentences`, which trims separators
    /// to empty and filters them out.
    fn segs(&self) -> &[RawSeg] {
        self.segs.get_or_init(|| {
            let base = self.content.as_ptr() as usize;
            let end = base + self.content.len();
            let mut spans: Vec<RawSeg> = Vec::new();
            let mut cursor = 0usize;
            for seg in sentencex::segment(self.lang, self.content) {
                let ptr = seg.as_ptr() as usize;
                if ptr < base || ptr + seg.len() > end {
                    continue;
                }
                let raw_start = ptr - base;
                if raw_start < cursor {
                    continue;
                }
                cursor = raw_start + seg.len();
                spans.push(RawSeg { raw_start, raw_end: cursor });
            }
            spans
        })
    }

    pub fn resolve_scope_range(&self, char_start: usize, scope: &Scope) -> Option<ScopeRange> {
        let (start, end) = match scope {
            Scope::Words(n) => self.resolve_words(char_start, *n)?,
            Scope::Sentence(n) => self.resolve_sentence(char_start, *n)?,
            Scope::Paragraph(n) => self.resolve_paragraph(char_start, *n)?,
            Scope::Page(n) => self.resolve_page(char_start, *n)?,
            Scope::Anchor(text) => self.resolve_anchor(char_start, text)?,
            Scope::Document => {
                return Some(ScopeRange { start: 0, end: self.to_u16(self.content.len()) })
            }
            Scope::Section => self.resolve_section(char_start)?,
            Scope::Asymmetric { unit, before, after } => {
                self.resolve_asymmetric(char_start, unit, *before, *after)?
            }
        };
        Some(ScopeRange { start, end })
    }

    pub fn resolve_scope_range_with_mode(
        &self,
        char_start: usize,
        scope: &Scope,
        mode: &ResolutionMode,
    ) -> Option<ScopeRange> {
        match mode {
            ResolutionMode::Backward => self.resolve_scope_range(char_start, scope),
            ResolutionMode::Bidirectional => {
                let backward = self.resolve_scope_range(char_start, scope)?;
                match scope {
                    Scope::Words(n) => Some(ScopeRange {
                        start: backward.start,
                        end: self.resolve_forward_words(char_start, *n).unwrap_or(backward.end),
                    }),
                    Scope::Sentence(n) => Some(ScopeRange {
                        start: backward.start,
                        end: self.resolve_forward_sentences(char_start, *n).unwrap_or(backward.end),
                    }),
                    Scope::Paragraph(n) => Some(ScopeRange {
                        start: backward.start,
                        end: self.resolve_forward_paragraphs(char_start, *n).unwrap_or(backward.end),
                    }),
                    Scope::Page(n) => Some(ScopeRange {
                        start: backward.start,
                        end: self.resolve_forward_pages(char_start, *n).unwrap_or(backward.end),
                    }),
                    _ => Some(backward),
                }
            }
        }
    }

    pub fn extract_text_for_range(&self, range: &ScopeRange) -> String {
        let byte_start = self.to_byte(range.start);
        let byte_end = self.to_byte(range.end);
        self.content[byte_start..byte_end].to_string()
    }

    fn resolve_words(&self, char_start: usize, n: usize) -> Option<(usize, usize)> {
        if n == 0 {
            return None;
        }
        let byte_start = self.to_byte(char_start);
        let text_before = &self.content[..byte_start];

        let trimmed = text_before.trim_end();
        if trimmed.is_empty() {
            return None;
        }
        let scope_end_byte = trimmed.len();

        let mut words_found = 0;
        let mut scope_start_byte = 0;
        let mut in_word = false;

        for (i, ch) in trimmed.char_indices().rev() {
            if ch.is_whitespace() {
                if in_word {
                    words_found += 1;
                    if words_found >= n {
                        scope_start_byte = i + ch.len_utf8();
                        break;
                    }
                    in_word = false;
                }
            } else {
                in_word = true;
            }
        }

        if words_found < n && in_word {
            words_found += 1;
        }
        if words_found < n {
            scope_start_byte = 0;
        }

        Some((self.to_u16(scope_start_byte), self.to_u16(scope_end_byte)))
    }

    /// Trimmed non-empty sentences of `content[..te]`, reconstructed from the
    /// cached full-body segmentation instead of re-segmenting the prefix:
    /// complete segments ending at or before the cut, plus the trailing
    /// fragment of the segment the cut lands in. Mirrors
    /// `split_sentences(content[..te])`.
    fn prefix_sentences(&self, te: usize) -> Vec<&'a str> {
        let mut sentences = Vec::new();
        for seg in self.segs() {
            let end = if seg.raw_end <= te {
                seg.raw_end
            } else if seg.raw_start < te {
                te
            } else {
                break;
            };
            let s = self.content[seg.raw_start..end].trim();
            if !s.is_empty() {
                sentences.push(s);
            }
            if end == te {
                break;
            }
        }
        sentences
    }

    fn resolve_sentence(&self, char_start: usize, n: usize) -> Option<(usize, usize)> {
        if n == 0 {
            return None;
        }
        let byte_start = self.to_byte(char_start);
        let text_before = &self.content[..byte_start];
        let trimmed = text_before.trim_end();
        if trimmed.is_empty() {
            return None;
        }

        let sentences = self.prefix_sentences(trimmed.len());
        if sentences.is_empty() {
            return None;
        }

        let take = n.min(sentences.len());
        let first_sentence = sentences[sentences.len() - take];
        let last_sentence = sentences[sentences.len() - 1];

        let (first_start, _) = ws_flexible_find(trimmed, first_sentence, 0)?;
        let (_, last_end) = ws_flexible_find(trimmed, last_sentence, first_start)?;

        let scope_start_byte = first_start;
        let scope_end_byte = last_end.min(trimmed.len());

        Some((self.to_u16(scope_start_byte), self.to_u16(scope_end_byte)))
    }

    fn resolve_paragraph(&self, char_start: usize, n: usize) -> Option<(usize, usize)> {
        if n == 0 {
            return None;
        }
        let byte_start = self.to_byte(char_start);
        let text_before = &self.content[..byte_start];
        let trimmed = text_before.trim_end();
        if trimmed.is_empty() {
            return None;
        }

        let scope_end_byte = trimmed.len();

        let mut para_boundaries: Vec<usize> = vec![0];
        let mut i = 0;
        let bytes = trimmed.as_bytes();
        while i + 1 < bytes.len() {
            if bytes[i] == b'\n' && bytes[i + 1] == b'\n' {
                let mut end = i + 2;
                while end < bytes.len() && bytes[end] == b'\n' {
                    end += 1;
                }
                para_boundaries.push(end);
                i = end;
            } else {
                i += 1;
            }
        }

        let boundary_idx = if para_boundaries.len() >= n {
            para_boundaries.len() - n
        } else {
            0
        };
        let scope_start_byte = para_boundaries[boundary_idx];

        Some((self.to_u16(scope_start_byte), self.to_u16(scope_end_byte)))
    }

    fn resolve_page(&self, char_start: usize, n: usize) -> Option<(usize, usize)> {
        if n == 0 {
            return None;
        }
        let byte_start = self.to_byte(char_start);
        let text_before = &self.content[..byte_start];
        let trimmed = text_before.trim_end();
        if trimmed.is_empty() {
            return None;
        }

        let scope_end_byte = trimmed.len();

        let mut page_boundaries: Vec<usize> = vec![0];
        for (i, b) in trimmed.bytes().enumerate() {
            if b == b'\x0C' {
                page_boundaries.push(i + 1);
            }
        }

        let boundary_idx = if page_boundaries.len() >= n {
            page_boundaries.len() - n
        } else {
            0
        };
        let scope_start_byte = page_boundaries[boundary_idx];

        Some((self.to_u16(scope_start_byte), self.to_u16(scope_end_byte)))
    }

    /// Forward mirror of `prefix_sentences`: trimmed non-empty sentences of
    /// `content[ts..]`, reconstructed from the cached segmentation — the
    /// trailing part of the segment the cut lands in, then whole later
    /// segments. Mirrors `split_sentences(content[ts..])`.
    fn suffix_sentences(&self, ts: usize) -> Vec<&'a str> {
        let mut sentences = Vec::new();
        for seg in self.segs() {
            if seg.raw_end <= ts {
                continue;
            }
            let start = seg.raw_start.max(ts);
            let s = self.content[start..seg.raw_end].trim();
            if !s.is_empty() {
                sentences.push(s);
            }
        }
        sentences
    }

    fn resolve_forward_words(&self, char_start: usize, n: usize) -> Option<usize> {
        if n == 0 {
            return Some(char_start);
        }
        let byte_start = self.to_byte(char_start);
        let text_after = &self.content[byte_start..];
        let trimmed = text_after.trim_start();
        let trim_offset = text_after.len() - trimmed.len();

        let mut words_found = 0;
        let mut end_byte = 0;
        let mut in_word = false;

        for (i, ch) in trimmed.char_indices() {
            if ch.is_whitespace() {
                if in_word {
                    words_found += 1;
                    end_byte = i;
                    if words_found >= n {
                        break;
                    }
                    in_word = false;
                }
            } else {
                in_word = true;
            }
        }

        if in_word && words_found < n {
            words_found += 1;
            end_byte = trimmed.len();
        }

        if words_found == 0 {
            return None;
        }

        Some(self.to_u16(byte_start + trim_offset + end_byte))
    }

    fn resolve_forward_sentences(&self, char_start: usize, n: usize) -> Option<usize> {
        if n == 0 {
            return Some(char_start);
        }
        let byte_start = self.to_byte(char_start);
        let text_after = &self.content[byte_start..];
        let trimmed = text_after.trim_start();
        if trimmed.is_empty() {
            return None;
        }
        let trim_offset = text_after.len() - trimmed.len();

        let sentences = self.suffix_sentences(byte_start + trim_offset);
        if sentences.is_empty() {
            return None;
        }

        let take = n.min(sentences.len());
        let target_sentence = sentences[take - 1];

        let (_, sent_end) = ws_flexible_find(trimmed, target_sentence, 0)?;

        Some(self.to_u16(byte_start + trim_offset + sent_end))
    }

    fn resolve_forward_paragraphs(&self, char_start: usize, n: usize) -> Option<usize> {
        if n == 0 {
            return Some(char_start);
        }
        let byte_start = self.to_byte(char_start);
        let text_after = &self.content[byte_start..];
        let bytes = text_after.as_bytes();

        let mut i = 0;
        while i < bytes.len() && bytes[i] == b'\n' {
            i += 1;
        }

        let mut paras_found = 0;
        while i + 1 < bytes.len() {
            if bytes[i] == b'\n' && bytes[i + 1] == b'\n' {
                paras_found += 1;
                if paras_found >= n {
                    return Some(self.to_u16(byte_start + i));
                }
                while i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                    i += 1;
                }
            }
            i += 1;
        }

        Some(self.to_u16(self.content.len()))
    }

    fn resolve_forward_pages(&self, char_start: usize, n: usize) -> Option<usize> {
        if n == 0 {
            return Some(char_start);
        }
        let byte_start = self.to_byte(char_start);
        let text_after = &self.content[byte_start..];
        let bytes = text_after.as_bytes();

        let mut start = 0;
        while start < bytes.len() && bytes[start] == b'\x0C' {
            start += 1;
        }

        let mut pages_found = 0;
        for (i, b) in text_after[start..].bytes().enumerate() {
            if b == b'\x0C' {
                pages_found += 1;
                if pages_found >= n {
                    return Some(self.to_u16(byte_start + start + i));
                }
            }
        }

        Some(self.to_u16(self.content.len()))
    }

    fn resolve_asymmetric(
        &self,
        char_start: usize,
        unit: &ScopeKind,
        before: usize,
        after: usize,
    ) -> Option<(usize, usize)> {
        let backward_scope = match unit {
            ScopeKind::Word => Scope::Words(before),
            ScopeKind::Sentence => Scope::Sentence(before),
            ScopeKind::Paragraph => Scope::Paragraph(before),
            ScopeKind::Page => Scope::Page(before),
        };

        let start = if before == 0 {
            char_start
        } else {
            self.resolve_scope_range(char_start, &backward_scope)
                .map(|r| r.start)
                .unwrap_or(char_start)
        };

        let end = match unit {
            ScopeKind::Word => self.resolve_forward_words(char_start, after),
            ScopeKind::Sentence => self.resolve_forward_sentences(char_start, after),
            ScopeKind::Paragraph => self.resolve_forward_paragraphs(char_start, after),
            ScopeKind::Page => self.resolve_forward_pages(char_start, after),
        }
        .unwrap_or(char_start);

        Some((start, end))
    }

    fn resolve_anchor(&self, char_start: usize, anchor: &str) -> Option<(usize, usize)> {
        let byte_start = self.to_byte(char_start);
        let text_before = &self.content[..byte_start];

        let pos = text_before.rfind(anchor)?;
        Some((self.to_u16(pos), self.to_u16(pos + anchor.len())))
    }

    fn resolve_section(&self, char_start: usize) -> Option<(usize, usize)> {
        let content = self.content;
        let byte_start = self.to_byte(char_start);

        let mut headings: Vec<(usize, usize)> = Vec::new();
        let mut in_fence = false;
        let mut line_start = 0;
        for line in content.split('\n') {
            let trimmed = line.trim_start();
            if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
                in_fence = !in_fence;
            } else if !in_fence && trimmed.starts_with('#') {
                let level = trimmed.bytes().take_while(|&b| b == b'#').count();
                if level <= 6 && trimmed.as_bytes().get(level) == Some(&b' ') {
                    headings.push((line_start, level));
                }
            }
            line_start += line.len() + 1;
        }

        if headings.is_empty() {
            return Some((0, self.to_u16(content.len())));
        }

        let current_idx = headings.iter().rposition(|(off, _)| *off <= byte_start);

        let (section_byte_start, current_level) = match current_idx {
            Some(idx) => (headings[idx].0, headings[idx].1),
            None => {
                let end_byte = headings[0].0;
                return Some((0, self.to_u16(end_byte)));
            }
        };

        let section_byte_end = headings[current_idx.unwrap() + 1..]
            .iter()
            .find(|(_, lvl)| *lvl <= current_level)
            .map(|(off, _)| *off)
            .unwrap_or(content.len());

        Some((self.to_u16(section_byte_start), self.to_u16(section_byte_end)))
    }
}
fn ws_flexible_find(haystack: &str, needle: &str, start_from: usize) -> Option<(usize, usize)> {
    let parts: Vec<&str> = needle.split_whitespace().collect();
    if parts.is_empty() {
        return None;
    }

    let mut offset = start_from;
    loop {
        let rel_pos = haystack[offset..].find(parts[0])?;
        let match_start = offset + rel_pos;
        let mut cursor = match_start + parts[0].len();

        let mut ok = true;
        for part in &parts[1..] {
            let rest = &haystack[cursor..];
            let ws = rest.len() - rest.trim_start().len();
            if ws == 0 {
                ok = false;
                break;
            }
            cursor += ws;
            if haystack[cursor..].starts_with(part) {
                cursor += part.len();
            } else {
                ok = false;
                break;
            }
        }

        if ok {
            return Some((match_start, cursor));
        }

        match haystack[offset + rel_pos..].char_indices().nth(1) {
            Some((next, _)) => offset += rel_pos + next,
            None => return None,
        }
    }
}

/// One-shot wrapper over [`ScopeResolveCtx::extract_text_for_range`].
pub fn extract_text_for_range(content: &str, range: &ScopeRange) -> String {
    ScopeResolveCtx::new(content, "en").extract_text_for_range(range)
}

/// One-shot wrapper over [`ScopeResolveCtx::resolve_scope_range_with_mode`].
pub fn resolve_scope_range_with_mode(
    content: &str,
    char_start: usize,
    scope: &Scope,
    lang: &str,
    mode: &ResolutionMode,
) -> Option<ScopeRange> {
    ScopeResolveCtx::new(content, lang).resolve_scope_range_with_mode(char_start, scope, mode)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::annotation::scanner::utf16_len;

    // -----------------------------------------------------------------------
    // Reference implementations: the pre-ScopeResolveCtx resolver bodies,
    // kept verbatim so the ctx parity tests stay a genuine independent lock
    // (they re-segment the prefix/suffix per call instead of reconstructing
    // from the shared full-body segmentation).
    // -----------------------------------------------------------------------

    fn split_sentences(text: &str, lang: &str) -> Vec<String> {
        sentencex::segment(lang, text)
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    }

    fn utf16_to_byte(s: &str, utf16_offset: usize) -> usize {
        let mut utf16_acc = 0;
        for (byte_idx, ch) in s.char_indices() {
            if utf16_acc >= utf16_offset {
                return byte_idx;
            }
            utf16_acc += ch.len_utf16();
        }
        s.len()
    }

    fn resolve_sentence(content: &str, char_start: usize, n: usize, lang: &str) -> Option<(usize, usize)> {
        if n == 0 {
            return None;
        }
        let byte_start = utf16_to_byte(content, char_start);
        let text_before = &content[..byte_start];
        let trimmed = text_before.trim_end();
        if trimmed.is_empty() {
            return None;
        }

        let sentences = split_sentences(trimmed, lang);
        if sentences.is_empty() {
            return None;
        }

        let take = n.min(sentences.len());
        let first_sentence = &sentences[sentences.len() - take];
        let last_sentence = &sentences[sentences.len() - 1];

        let (first_start, _) = ws_flexible_find(trimmed, first_sentence, 0)?;
        let (_, last_end) = ws_flexible_find(trimmed, last_sentence, first_start)?;

        let scope_start_byte = first_start;
        let scope_end_byte = last_end.min(trimmed.len());

        let scope_start_utf16 = utf16_len(&content[..scope_start_byte]);
        let scope_end_utf16 = utf16_len(&content[..scope_end_byte]);

        Some((scope_start_utf16, scope_end_utf16))
    }

    fn resolve_paragraph(content: &str, char_start: usize, n: usize) -> Option<(usize, usize)> {
        if n == 0 {
            return None;
        }
        let byte_start = utf16_to_byte(content, char_start);
        let text_before = &content[..byte_start];
        let trimmed = text_before.trim_end();
        if trimmed.is_empty() {
            return None;
        }

        let scope_end_byte = trimmed.len();

        let mut para_boundaries: Vec<usize> = vec![0];
        let mut i = 0;
        let bytes = trimmed.as_bytes();
        while i + 1 < bytes.len() {
            if bytes[i] == b'\n' && bytes[i + 1] == b'\n' {
                let mut end = i + 2;
                while end < bytes.len() && bytes[end] == b'\n' {
                    end += 1;
                }
                para_boundaries.push(end);
                i = end;
            } else {
                i += 1;
            }
        }

        let boundary_idx = if para_boundaries.len() >= n {
            para_boundaries.len() - n
        } else {
            0
        };
        let scope_start_byte = para_boundaries[boundary_idx];

        let scope_start_utf16 = utf16_len(&content[..scope_start_byte]);
        let scope_end_utf16 = utf16_len(&content[..scope_end_byte]);

        Some((scope_start_utf16, scope_end_utf16))
    }

    fn resolve_forward_sentences(content: &str, char_start: usize, n: usize, lang: &str) -> Option<usize> {
        if n == 0 {
            return Some(char_start);
        }
        let byte_start = utf16_to_byte(content, char_start);
        let text_after = &content[byte_start..];
        let trimmed = text_after.trim_start();
        if trimmed.is_empty() {
            return None;
        }

        let sentences = split_sentences(trimmed, lang);
        if sentences.is_empty() {
            return None;
        }

        let take = n.min(sentences.len());
        let target_sentence = &sentences[take - 1];

        let trim_offset = text_after.len() - trimmed.len();
        let (_, sent_end) = ws_flexible_find(trimmed, target_sentence, 0)?;

        let abs_byte = byte_start + trim_offset + sent_end;
        Some(utf16_len(&content[..abs_byte]))
    }

    #[test]
    fn words_1_single_preceding_word() {
        let content = "hello <!--- n: _ | note --->";
        let char_start = 6;
        let result = resolve_scope_range(content, char_start, &Scope::Words(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 0, end: 5 }));
    }

    #[test]
    fn words_2_two_preceding_words() {
        let content = "the quick brown fox <!--- n: __ | note --->";
        let char_start = 20;
        let result = resolve_scope_range(content, char_start, &Scope::Words(2), "en");
        assert_eq!(result, Some(ScopeRange { start: 10, end: 19 }));
    }

    #[test]
    fn words_3_three_preceding_words() {
        let content = "the quick brown fox <!--- n: ___ | note --->";
        let char_start = 20;
        let result = resolve_scope_range(content, char_start, &Scope::Words(3), "en");
        assert_eq!(result, Some(ScopeRange { start: 4, end: 19 }));
    }

    #[test]
    fn words_more_than_available() {
        let content = "brown fox <!--- n: | note --->";
        let char_start = 10;
        let result = resolve_scope_range(content, char_start, &Scope::Words(5), "en");
        assert_eq!(result, Some(ScopeRange { start: 0, end: 9 }));
    }

    #[test]
    fn words_with_cjk() {
        let content = "你好 世界 <!--- n: __ | note --->";
        let char_start = 5;
        let result = resolve_scope_range(content, char_start, &Scope::Words(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 3, end: 5 }));
    }

    #[test]
    fn words_no_preceding_text() {
        let content = "<!--- n: _ | note --->";
        let char_start = 0;
        let result = resolve_scope_range(content, char_start, &Scope::Words(1), "en");
        assert_eq!(result, None);
    }

    #[test]
    fn words_only_whitespace_before() {
        let content = "   <!--- n: _ | note --->";
        let char_start = 3;
        let result = resolve_scope_range(content, char_start, &Scope::Words(1), "en");
        assert_eq!(result, None);
    }

    #[test]
    fn sentence_single_sentence() {
        let content = "The cat sat on the mat.<!--- n: | note --->";
        let char_start = 23;
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 0, end: 23 }));
    }

    #[test]
    fn sentence_last_of_multiple_sentences() {
        let content = "The dog ran. The cat sat.<!--- n: | note --->";
        let char_start = 25;
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 13, end: 25 }));
    }

    #[test]
    fn sentence_two_of_multiple() {
        let content = "First one. The dog ran. The cat sat.<!--- n: \\ss | note --->";
        let char_start = 36;
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(2), "en");
        assert_eq!(result, Some(ScopeRange { start: 11, end: 36 }));
    }

    #[test]
    fn sentence_more_than_available() {
        let content = "The dog ran. The cat sat.<!--- n: \\sss | note --->";
        let char_start = 25;
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(3), "en");
        assert_eq!(result, Some(ScopeRange { start: 0, end: 25 }));
    }

    #[test]
    fn sentence_mid_sentence() {
        let content = "The dog ran. The cat sat<!--- n: | note ---> on the mat.";
        let char_start = 25;
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 13, end: 25 }));
    }

    #[test]
    fn sentence_no_preceding_text() {
        let content = "<!--- n: | note --->";
        let char_start = 0;
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(1), "en");
        assert_eq!(result, None);
    }

    #[test]
    fn paragraph_1_current_paragraph() {
        let content = "First paragraph.\n\nSecond paragraph text.<!--- n: \\p | note --->";
        let char_start = 40;
        let result = resolve_scope_range(content, char_start, &Scope::Paragraph(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 18, end: 40 }));
    }

    #[test]
    fn paragraph_2_current_and_preceding() {
        let content = "First para.\n\nSecond para.\n\nThird para.<!--- n: \\pp | note --->";
        let char_start = 38;
        let result = resolve_scope_range(content, char_start, &Scope::Paragraph(2), "en");
        assert_eq!(result, Some(ScopeRange { start: 13, end: 38 }));
    }

    #[test]
    fn paragraph_more_than_available() {
        let content = "Only paragraph.<!--- n: \\ppp | note --->";
        let char_start = 15;
        let result = resolve_scope_range(content, char_start, &Scope::Paragraph(3), "en");
        assert_eq!(result, Some(ScopeRange { start: 0, end: 15 }));
    }

    #[test]
    fn paragraph_no_preceding_text() {
        let content = "<!--- n: \\p | note --->";
        let char_start = 0;
        let result = resolve_scope_range(content, char_start, &Scope::Paragraph(1), "en");
        assert_eq!(result, None);
    }

    #[test]
    fn page_1_current_page() {
        let content = "Page one.\x0CPage two text.<!--- n: \\f | note --->";
        let char_start = 25;
        let result = resolve_scope_range(content, char_start, &Scope::Page(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 10, end: 25 }));
    }

    #[test]
    fn page_2_current_and_preceding() {
        let content = "Page one.\x0CPage two.\x0CPage three.<!--- n: | note --->";
        let char_start = 31;
        let result = resolve_scope_range(content, char_start, &Scope::Page(2), "en");
        assert_eq!(result, Some(ScopeRange { start: 10, end: 31 }));
    }

    #[test]
    fn page_no_form_feed() {
        let content = "All one page.<!--- n: \\f | note --->";
        let char_start = 14;
        let result = resolve_scope_range(content, char_start, &Scope::Page(1), "en");
        assert_eq!(result, Some(ScopeRange { start: 0, end: 14 }));
    }

    #[test]
    fn anchor_found() {
        let content = "The term anuttara appears in this text.<!--- n: ^\"anuttara\" | note --->";
        let char_start = 39;
        let result = resolve_scope_range(
            content, char_start,
            &Scope::Anchor("anuttara".to_string()), "en",
        );
        assert_eq!(result, Some(ScopeRange { start: 9, end: 17 }));
    }

    #[test]
    fn anchor_not_found() {
        let content = "No match here.<!--- n: ^\"missing\" | note --->";
        let char_start = 15;
        let result = resolve_scope_range(
            content, char_start,
            &Scope::Anchor("missing".to_string()), "en",
        );
        assert_eq!(result, None);
    }

    #[test]
    fn sentence_with_double_spaces() {
        let content = "Maximum depth  $d = 5$  and composition.<!--- n: | note --->";
        let ann_start = content.find("<!---").unwrap();
        let ann_start_utf16 = utf16_len(&content[..ann_start]);
        let result = resolve_scope_range(content, ann_start_utf16, &Scope::Sentence(1), "en");
        assert!(result.is_some(), "scope should resolve despite double spaces");
        let range = result.unwrap();
        assert_eq!(range.start, 0);
        assert_eq!(range.end, ann_start_utf16);
    }

    #[test]
    fn sentence_double_spaces_multi_sentence() {
        let content = "First sentence. Second  has  double  spaces.<!--- n: | note --->";
        let ann_start = content.find("<!---").unwrap();
        let ann_start_utf16 = utf16_len(&content[..ann_start]);
        let result = resolve_scope_range(content, ann_start_utf16, &Scope::Sentence(1), "en");
        assert!(result.is_some());
        let range = result.unwrap();
        assert_eq!(range.start, 16);
        assert_eq!(range.end, ann_start_utf16);
    }

    #[test]
    fn ws_flex_exact_match() {
        assert_eq!(ws_flexible_find("hello world", "hello world", 0), Some((0, 11)));
    }

    #[test]
    fn ws_flex_double_space_in_haystack() {
        assert_eq!(ws_flexible_find("hello  world", "hello world", 0), Some((0, 12)));
    }

    #[test]
    fn ws_flex_multiple_double_spaces() {
        assert_eq!(ws_flexible_find("a  b  c", "a b c", 0), Some((0, 7)));
    }

    #[test]
    fn ws_flex_start_offset() {
        assert_eq!(ws_flexible_find("xx hello  world", "hello world", 3), Some((3, 15)));
    }

    #[test]
    fn ws_flex_no_match() {
        assert_eq!(ws_flexible_find("hello world", "goodbye", 0), None);
    }

    #[test]
    fn document_scope_entire_content() {
        let content = "First line.\n\nSecond paragraph.\n\nThird paragraph.";
        let result = resolve_scope_range(content, 12, &Scope::Document, "en");
        assert_eq!(result, Some(ScopeRange { start: 0, end: utf16_len(content) }));
    }

    #[test]
    fn document_scope_empty() {
        assert_eq!(
            resolve_scope_range("", 0, &Scope::Document, "en"),
            Some(ScopeRange { start: 0, end: 0 })
        );
    }

    #[test]
    fn section_scope_middle_heading() {
        let content = "# Intro\n\nSome text.\n\n## Methods\n\nMethod details.<!--- n --->\n\n## Results\n\nResult text.";
        let ann_pos = content.find("<!---").unwrap();
        let char_start = utf16_len(&content[..ann_pos]);
        let result = resolve_scope_range(content, char_start, &Scope::Section, "en");
        let range = result.unwrap();
        let expected_start = utf16_len(&content[..content.find("## Methods").unwrap()]);
        let expected_end = utf16_len(&content[..content.find("## Results").unwrap()]);
        assert_eq!(range.start, expected_start);
        assert_eq!(range.end, expected_end);
    }

    #[test]
    fn section_scope_last_heading() {
        let content = "# Title\n\nText.\n\n## Last Section\n\nFinal text.";
        let char_start = utf16_len(&content[..content.len() - 5]);
        let range = resolve_scope_range(content, char_start, &Scope::Section, "en").unwrap();
        assert_eq!(range.start, utf16_len(&content[..content.find("## Last Section").unwrap()]));
        assert_eq!(range.end, utf16_len(content));
    }

    #[test]
    fn section_scope_no_headings() {
        let content = "Just plain text with no headings.";
        let range = resolve_scope_range(content, 5, &Scope::Section, "en").unwrap();
        assert_eq!(range, ScopeRange { start: 0, end: utf16_len(content) });
    }

    #[test]
    fn section_scope_before_first_heading() {
        let content = "Preamble text.\n\n# First Heading\n\nBody.";
        let range = resolve_scope_range(content, 3, &Scope::Section, "en").unwrap();
        assert_eq!(range.start, 0);
        assert_eq!(range.end, utf16_len(&content[..content.find("# First Heading").unwrap()]));
    }

    #[test]
    fn asymmetric_words_forward() {
        let content = "alpha beta gamma delta epsilon";
        let char_start = utf16_len(&content[..content.find(" gamma").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Word, before: 1, after: 2 },
            "en",
        );
        let range = result.unwrap();
        assert_eq!(range.start, utf16_len(&content[..content.find("beta").unwrap()]));
        assert_eq!(range.end, utf16_len(&content[..content.find("delta").unwrap() + "delta".len()]));
    }

    #[test]
    fn asymmetric_sentence_forward() {
        let content = "Before sentence. After first. After second. After third.";
        let char_start = utf16_len(&content[..content.find(" After").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Sentence, before: 1, after: 2 },
            "en",
        );
        let range = result.unwrap();
        assert_eq!(range.start, 0);
        assert_eq!(range.end, utf16_len(&content[..content.find(" After third").unwrap()]));
    }

    #[test]
    fn asymmetric_paragraph_forward() {
        let content = "Before.\n\nMiddle.\n\nAfter one.\n\nAfter two.";
        let char_start = utf16_len(&content[..content.find("\n\nAfter").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Paragraph, before: 1, after: 1 },
            "en",
        );
        let range = result.unwrap();
        assert_eq!(range.end, utf16_len(&content[..content.find("\n\nAfter two").unwrap()]));
    }

    #[test]
    fn asymmetric_page_forward() {
        let content = "Page one.\x0CPage two.\x0CPage three.\x0CPage four.";
        let char_start = utf16_len(&content[..content.find("\x0CPage three").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Page, before: 1, after: 1 },
            "en",
        );
        let range = result.unwrap();
        assert_eq!(range.end, utf16_len(&content[..content.rfind("\x0CPage four").unwrap()]));
    }

    #[test]
    fn bidirectional_paragraph() {
        let content = "Before.\n\nMiddle.\n\nAfter.";
        let char_start = utf16_len(&content[..content.find("\n\nAfter").unwrap()]);
        let result = resolve_scope_range_with_mode(
            content,
            char_start,
            &Scope::Paragraph(1),
            "en",
            &ResolutionMode::Bidirectional,
        );
        let range = result.unwrap();
        let middle_start = utf16_len(&content[..content.find("Middle").unwrap()]);
        assert_eq!(range.start, middle_start);
        assert_eq!(range.end, utf16_len(content));
    }

    #[test]
    fn backward_mode_matches_original() {
        let content = "hello world <!--- n --->";
        let cs = utf16_len(&content[..content.find("<!---").unwrap()]);
        let backward = resolve_scope_range_with_mode(content, cs, &Scope::Words(1), "en", &ResolutionMode::Backward);
        let original = resolve_scope_range(content, cs, &Scope::Words(1), "en");
        assert_eq!(backward, original);
    }

    // --- Cycle 1: ws_flexible_find handles \n\n ---

    #[test]
    fn ws_flex_double_newline_in_haystack() {
        assert_eq!(ws_flexible_find("hello\n\nworld", "hello world", 0), Some((0, 12)));
    }

    #[test]
    fn ws_flex_newline_and_spaces_mixed() {
        assert_eq!(ws_flexible_find("a\n\nb\n\nc", "a b c", 0), Some((0, 7)));
    }

    // --- Cycle 2: backward sentence crosses paragraph boundary ---

    #[test]
    fn sentence_crosses_paragraph_boundary_backward() {
        let content = "First sentence.\n\nSecond sentence.<!--- n \\ss | note --->";
        let char_start = utf16_len(&content[..content.find("<!---").unwrap()]);
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(2), "en");
        let range = result.unwrap();
        assert_eq!(range.start, 0);
    }

    #[test]
    fn sentence_one_in_current_para_backward() {
        let content = "First sentence.\n\nSecond sentence.<!--- n \\s | note --->";
        let char_start = utf16_len(&content[..content.find("<!---").unwrap()]);
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(1), "en");
        let range = result.unwrap();
        let expected_start = utf16_len(&content[..content.find("Second").unwrap()]);
        assert_eq!(range.start, expected_start);
    }

    // --- Cycle 3: backward edge cases ---

    #[test]
    fn sentence_crosses_two_paragraph_boundaries_backward() {
        let content = "First sentence.\n\nSecond sentence.\n\nThird sentence.<!--- n \\sss | note --->";
        let char_start = utf16_len(&content[..content.find("<!---").unwrap()]);
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(3), "en");
        let range = result.unwrap();
        assert_eq!(range.start, 0);
    }

    #[test]
    fn sentence_more_than_available_cross_paragraph_backward() {
        let content = "First sentence.\n\nSecond sentence.<!--- n | note --->";
        let char_start = utf16_len(&content[..content.find("<!---").unwrap()]);
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(5), "en");
        let range = result.unwrap();
        assert_eq!(range.start, 0);
    }

    #[test]
    fn sentence_empty_paragraph_between_content_backward() {
        let content = "First sentence.\n\n\n\nSecond sentence.<!--- n \\ss | note --->";
        let char_start = utf16_len(&content[..content.find("<!---").unwrap()]);
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(2), "en");
        let range = result.unwrap();
        assert_eq!(range.start, 0);
    }

    // --- Cycle 4: forward sentence crosses paragraph boundary ---

    #[test]
    fn forward_sentence_crosses_paragraph_boundary() {
        let content = "Before. First fwd.\n\nSecond fwd.";
        let char_start = utf16_len(&content[..content.find(" First").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Sentence, before: 1, after: 2 },
            "en",
        );
        let range = result.unwrap();
        assert_eq!(range.end, utf16_len(content));
    }

    #[test]
    fn forward_sentence_one_in_current_paragraph() {
        let content = "Before. First fwd.\n\nSecond fwd.";
        let char_start = utf16_len(&content[..content.find(" First").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Sentence, before: 1, after: 1 },
            "en",
        );
        let range = result.unwrap();
        let expected_end = utf16_len(&content[..content.find("\n\nSecond").unwrap()]);
        assert_eq!(range.end, expected_end);
    }

    // --- Cycle 5: forward edge cases ---

    #[test]
    fn forward_sentence_more_than_available_cross_paragraph() {
        let content = "Before. First fwd.\n\nSecond fwd.";
        let char_start = utf16_len(&content[..content.find(" First").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Sentence, before: 1, after: 5 },
            "en",
        );
        let range = result.unwrap();
        assert_eq!(range.end, utf16_len(content));
    }

    #[test]
    fn forward_sentence_empty_paragraph_between() {
        let content = "Before. First fwd.\n\n\n\nSecond fwd.";
        let char_start = utf16_len(&content[..content.find(" First").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Sentence, before: 1, after: 2 },
            "en",
        );
        let range = result.unwrap();
        assert_eq!(range.end, utf16_len(content));
    }

    // --- Cycle 6: bidirectional + CJK ---

    #[test]
    fn bidirectional_sentence_crosses_paragraphs() {
        let content = "Sent A.\n\nSent B.\n\nSent C.\n\nSent D.";
        let char_start = utf16_len(&content[..content.find("\n\nSent C").unwrap()]);
        let result = resolve_scope_range_with_mode(
            content,
            char_start,
            &Scope::Sentence(2),
            "en",
            &ResolutionMode::Bidirectional,
        );
        let range = result.unwrap();
        assert_eq!(range.start, 0);
        assert_eq!(range.end, utf16_len(content));
    }

    #[test]
    fn sentence_crosses_paragraph_boundary_cjk() {
        let content = "第一句话。\n\n第二句话。<!--- n \\ss | note --->";
        let char_start = utf16_len(&content[..content.find("<!---").unwrap()]);
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(2), "zh");
        let range = result.unwrap();
        assert_eq!(range.start, 0);
    }

    #[test]
    fn sentence_cjk_with_prior_annotation_debris() {
        let content = "Silently count to 10 seconds before speaking\"\n--->\n\n4.接电话前先微笑(加州大学) -- not renders\n\n<!--- q \\s | what does this mean? --->";
        let char_start = utf16_len(&content[..content.rfind("<!---").unwrap()]);
        let result = resolve_sentence(content, char_start, 1, "en");
        assert!(result.is_some());
    }

    #[test]
    fn paragraph_cjk_with_prior_annotation_debris() {
        let content = "Silently count to 10 seconds before speaking\"\n--->\n\n4.接电话前先微笑(加州大学) -- not renders\n\n<!--- q \\p | what does this mean? --->";
        let char_start = utf16_len(&content[..content.rfind("<!---").unwrap()]);
        let result = resolve_paragraph(content, char_start, 1);
        assert!(result.is_some());
        let (start, end) = result.unwrap();
        let scope = &content[utf16_to_byte(content, start)..utf16_to_byte(content, end)];
        assert!(!scope.contains("<!---"));
    }

    #[test]
    fn forward_sentence_with_dashes_in_text() {
        let content = "Before. First -- important. After that.";
        let char_start = utf16_len(&content[..content.find(" First").unwrap()]);
        let result = resolve_scope_range(
            content,
            char_start,
            &Scope::Asymmetric { unit: ScopeKind::Sentence, before: 1, after: 1 },
            "en",
        );
        let range = result.unwrap();
        let expected_end = utf16_len(&content[..content.find(" After").unwrap()]);
        assert_eq!(range.end, expected_end);
    }

    #[test]
    fn sentence_with_double_comma_resolves() {
        let content = "First sentence. Second,, important sentence.<!--- n \\s | note --->";
        let char_start = utf16_len(&content[..content.find("<!---").unwrap()]);
        let result = resolve_scope_range(content, char_start, &Scope::Sentence(1), "en");
        assert!(result.is_some());
    }

    #[test]
    fn extract_text_for_range_ascii() {
        assert_eq!(
            extract_text_for_range("hello world", &ScopeRange { start: 6, end: 11 }),
            "world"
        );
    }

    #[test]
    fn extract_text_for_range_cjk() {
        assert_eq!(
            extract_text_for_range("你好世界", &ScopeRange { start: 0, end: 2 }),
            "你好"
        );
    }

    // --- Utf16ByteMap: parity with utf16_to_byte / utf16_len ---

    /// Asserts the map agrees with the reference free functions at every
    /// UTF-16 offset (including mid-surrogate) and every char boundary.
    fn assert_u16map_parity(content: &str) {
        let map = Utf16ByteMap::new(content);
        let total_u16 = utf16_len(content);
        for off in 0..=total_u16 + 2 {
            assert_eq!(
                map.to_byte(content, off),
                utf16_to_byte(content, off),
                "to_byte mismatch at utf16 offset {off} in {content:?}"
            );
        }
        let mut boundaries: Vec<usize> = content.char_indices().map(|(b, _)| b).collect();
        boundaries.push(content.len());
        for b in boundaries {
            assert_eq!(
                map.to_u16(content, b),
                utf16_len(&content[..b]),
                "to_u16 mismatch at byte {b} in {content:?}"
            );
        }
    }

    #[test]
    fn u16map_ascii() {
        assert_u16map_parity("hello world, plain ascii text.");
    }

    #[test]
    fn u16map_empty() {
        assert_u16map_parity("");
    }

    #[test]
    fn u16map_cjk() {
        assert_u16map_parity("你好，世界。第二句话。mixed ascii 结尾");
    }

    #[test]
    fn u16map_emoji_surrogate_pairs() {
        assert_u16map_parity("a😀b😀😀c héllo 你好");
    }

    #[test]
    fn u16map_stride_boundaries() {
        // Long non-ASCII content spanning several checkpoint strides.
        let content: String = "a你😀 x".repeat(1500);
        let map = Utf16ByteMap::new(&content);
        let total_u16 = utf16_len(&content);
        // Sample around stride multiples plus the extremes.
        let mut offsets: Vec<usize> = vec![0, 1, total_u16 - 1, total_u16, total_u16 + 5];
        for k in 1..=7 {
            let base = k * 1024;
            for delta in [0usize, 1, 2, 3] {
                if base + delta <= total_u16 {
                    offsets.push(base + delta);
                }
                if base >= delta {
                    offsets.push(base - delta);
                }
            }
        }
        for off in offsets {
            assert_eq!(
                map.to_byte(&content, off),
                utf16_to_byte(&content, off),
                "to_byte mismatch at utf16 offset {off}"
            );
            let byte = utf16_to_byte(&content, off);
            assert_eq!(
                map.to_u16(&content, byte),
                utf16_len(&content[..byte]),
                "to_u16 mismatch at byte {byte}"
            );
        }
    }

    // --- ScopeResolveCtx: shared full-body segmentation ---

    #[test]
    fn ctx_segs_cover_content_with_whitespace_gaps_only() {
        // sentencex 0.1.23 emits paragraph separators as a static "\n\n"
        // (not a subslice), so `segs()` keeps only true subslice segments:
        // spans must be monotonic, in-bounds, and any gap between them (or at
        // either edge) must be pure whitespace (a dropped separator).
        for (content, lang) in [
            ("The dog ran. The cat sat. A third one here.", "en"),
            ("First para.\n\nSecond para. With two sentences.", "en"),
            ("第一句话。第二句话。\n\n第三句话。", "zh"),
            ("  leading space. And trailing.  ", "en"),
            ("A.\n\n\n\nB. Multi blank separators.\n\n", "en"),
        ] {
            let ctx = ScopeResolveCtx::new(content, lang);
            let segs = ctx.segs();
            let mut prev_end = 0;
            for s in segs {
                assert!(
                    s.raw_start >= prev_end && s.raw_end >= s.raw_start && s.raw_end <= content.len(),
                    "spans must be monotonic and in-bounds in {content:?}"
                );
                assert!(
                    content[prev_end..s.raw_start].trim().is_empty(),
                    "gap {:?} before span must be whitespace-only in {content:?}",
                    &content[prev_end..s.raw_start]
                );
                prev_end = s.raw_end;
            }
            assert!(
                content[prev_end..].trim().is_empty(),
                "trailing gap must be whitespace-only in {content:?}"
            );
        }
    }

    #[test]
    fn ctx_segs_trimmed_match_split_sentences() {
        for (content, lang) in [
            ("The dog ran. The cat sat. A third one here.", "en"),
            ("First para.\n\nSecond para. With two sentences.", "en"),
            ("第一句话。第二句话。\n\n第三句话。", "zh"),
        ] {
            let ctx = ScopeResolveCtx::new(content, lang);
            let trimmed: Vec<String> = ctx
                .segs()
                .iter()
                .map(|s| content[s.raw_start..s.raw_end].trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            assert_eq!(
                trimmed,
                split_sentences(content, lang),
                "trimmed segments must match split_sentences for {content:?}"
            );
        }
    }

    #[test]
    fn ctx_segs_computed_once() {
        let ctx = ScopeResolveCtx::new("One sentence. Another sentence.", "en");
        let first = ctx.segs().as_ptr();
        let second = ctx.segs().as_ptr();
        assert_eq!(first, second, "segs() must return the same cached slice");
    }

    // --- ScopeResolveCtx: parity with the free-fn resolvers (non-sentence) ---

    /// Small corpus exercising ASCII, CJK, paragraphs, pages, and headings.
    fn parity_corpus() -> Vec<(&'static str, &'static str)> {
        vec![
            ("the quick brown fox jumps over the lazy dog <!--- n ---> tail", "en"),
            ("First para.\n\nSecond para.\n\nThird para. <!--- n ---> end", "en"),
            ("Page one.\x0CPage two.\x0CPage three. <!--- n ---> rest", "en"),
            ("# Intro\n\nText.\n\n## Methods\n\nDetails here. <!--- n --->\n\n## Results\n\nMore.", "en"),
            ("你好 世界 这是 中文 文本 <!--- n ---> 结尾", "zh"),
            ("émoji 😀 mixé width chars 你好 <!--- n ---> after", "en"),
            ("   ", "en"),
            ("", "en"),
        ]
    }

    /// Every char-boundary UTF-16 offset of `content`, for exhaustive sweeps.
    fn all_u16_offsets(content: &str) -> Vec<usize> {
        let mut offs: Vec<usize> = content
            .char_indices()
            .map(|(b, _)| utf16_len(&content[..b]))
            .collect();
        offs.push(utf16_len(content));
        offs
    }

    #[test]
    fn ctx_parity_non_sentence_scopes() {
        let scopes = [
            Scope::Words(1),
            Scope::Words(3),
            Scope::Words(50),
            Scope::Words(0),
            Scope::Paragraph(1),
            Scope::Paragraph(2),
            Scope::Paragraph(9),
            Scope::Page(1),
            Scope::Page(2),
            Scope::Anchor("quick".to_string()),
            Scope::Anchor("你好".to_string()),
            Scope::Anchor("missing-anchor".to_string()),
            Scope::Document,
            Scope::Section,
        ];
        for (content, lang) in parity_corpus() {
            let ctx = ScopeResolveCtx::new(content, lang);
            for cs in all_u16_offsets(content) {
                for scope in &scopes {
                    assert_eq!(
                        ctx.resolve_scope_range(cs, scope),
                        resolve_scope_range(content, cs, scope, lang),
                        "ctx/free-fn mismatch for {scope:?} at char_start {cs} in {content:?}"
                    );
                }
            }
        }
    }

    // --- ScopeResolveCtx: backward sentence parity via prefix reconstruction ---

    fn sentence_parity_corpus() -> Vec<(String, &'static str)> {
        let mut corpus: Vec<(String, &'static str)> = vec![
            // multi-sentence English, cuts at boundaries and mid-sentence
            ("The dog ran. The cat sat. A third sentence here. <!--- n --->".into(), "en"),
            // repeated identical sentence text (first-occurrence ws_flexible_find path)
            ("Repeat me. Something else. Repeat me. Final one. <!--- n --->".into(), "en"),
            // double-space whitespace inside sentences
            ("Maximum depth  $d = 5$  and  more. Second  has  double  spaces. <!--- n --->".into(), "en"),
            // CJK
            ("第一句话。第二句话。第三句话。<!--- n --->".into(), "zh"),
            // sentences across paragraph boundaries
            ("First para one. First para two.\n\nSecond para one. Second para two. <!--- n --->".into(), "en"),
        ];
        // >10KB doc crossing sentencex's internal chunking threshold
        let big: String = (0..200)
            .map(|i| format!("Sentence number {i} is right here today.\n\nParagraph {i} tail. "))
            .collect();
        assert!(big.len() > 10 * 1024);
        corpus.push((big, "en"));
        corpus
    }

    /// Char-boundary UTF-16 offsets, subsampled for large contents so the
    /// per-offset free-fn re-segmentation stays affordable in tests.
    fn sampled_u16_offsets(content: &str) -> Vec<usize> {
        let all = all_u16_offsets(content);
        if all.len() <= 400 {
            return all;
        }
        let stride = all.len() / 200;
        let mut sampled: Vec<usize> = all.iter().copied().step_by(stride).collect();
        // Always probe the extremes and the 10KB chunking threshold region.
        sampled.extend([all[0], all[all.len() - 1]]);
        for probe in [10 * 1024 - 3, 10 * 1024, 10 * 1024 + 3] {
            if probe < all.len() {
                sampled.push(all[probe]);
            }
        }
        sampled
    }

    #[test]
    fn ctx_parity_sentence_backward() {
        // Parity is swept over every prose offset up to and including the
        // annotation marker start (the production cut position). Cuts strictly
        // inside the `<!--- ... --->` marker are not production inputs and hit
        // the accepted prefix-vs-full-body segmentation non-identity
        // (sentencex lookahead differs around debris like a bare "<!").
        for (content, lang) in sentence_parity_corpus() {
            let content = content.as_str();
            let limit = content
                .find("<!---")
                .map(|b| utf16_len(&content[..b]))
                .unwrap_or(usize::MAX);
            let ctx = ScopeResolveCtx::new(content, lang);
            for cs in sampled_u16_offsets(content) {
                if cs > limit {
                    continue;
                }
                for n in [1usize, 2, 3, 100] {
                    assert_eq!(
                        ctx.resolve_sentence(cs, n),
                        resolve_sentence(content, cs, n, lang),
                        "ctx/free-fn sentence mismatch for n={n} at char_start {cs} in {content:?}"
                    );
                }
            }
        }
    }

    // --- ScopeResolveCtx: forward sentences, asymmetric, mode, extraction ---

    /// Word- and sentence-boundary cut positions (UTF-16): index 0, positions
    /// following whitespace, and positions following a sentence terminator.
    /// Mid-word cuts are excluded: truncating a word can fabricate an
    /// abbreviation-like fragment (e.g. "ra|n." → "n.") whose re-segmentation
    /// legitimately differs from the cached full-body boundaries — the
    /// accepted reconstruction non-identity.
    fn boundary_cut_offsets(content: &str) -> Vec<usize> {
        let mut offsets = vec![0usize];
        let mut prev: Option<char> = None;
        for (b, ch) in content.char_indices() {
            if let Some(p) = prev {
                if p.is_whitespace() || matches!(p, '.' | '!' | '?' | '。' | '！' | '？') {
                    offsets.push(utf16_len(&content[..b]));
                }
            }
            prev = Some(ch);
        }
        offsets.push(utf16_len(content));
        offsets
    }

    #[test]
    fn ctx_parity_forward_sentences() {
        // Same prose-offset domain rationale as ctx_parity_sentence_backward,
        // further restricted to boundary cuts (see boundary_cut_offsets).
        for (content, lang) in sentence_parity_corpus() {
            let content = content.as_str();
            let limit = content
                .find("<!---")
                .map(|b| utf16_len(&content[..b]))
                .unwrap_or(usize::MAX);
            let ctx = ScopeResolveCtx::new(content, lang);
            let mut cuts = boundary_cut_offsets(content);
            if cuts.len() > 250 {
                let stride = cuts.len() / 200;
                cuts = cuts.into_iter().step_by(stride).collect();
            }
            for cs in cuts {
                if cs > limit {
                    continue;
                }
                for n in [0usize, 1, 2, 100] {
                    assert_eq!(
                        ctx.resolve_forward_sentences(cs, n),
                        resolve_forward_sentences(content, cs, n, lang),
                        "ctx/free-fn forward-sentence mismatch for n={n} at char_start {cs} in {content:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn ctx_parity_asymmetric_and_mode() {
        let scopes = [
            Scope::Asymmetric { unit: ScopeKind::Sentence, before: 1, after: 2 },
            Scope::Asymmetric { unit: ScopeKind::Sentence, before: 0, after: 1 },
            Scope::Asymmetric { unit: ScopeKind::Word, before: 2, after: 2 },
            Scope::Asymmetric { unit: ScopeKind::Paragraph, before: 1, after: 1 },
            Scope::Asymmetric { unit: ScopeKind::Page, before: 1, after: 1 },
        ];
        let corpus = [
            ("Before sentence. After first. After second. After third.", "en"),
            ("Before.\n\nMiddle one. Middle two.\n\nAfter one.\n\nAfter two.", "en"),
            ("Page one.\x0CPage two.\x0CPage three.", "en"),
            ("第一句话。第二句话。\n\n第三句话。第四句话。", "zh"),
        ];
        for (content, lang) in corpus {
            let ctx = ScopeResolveCtx::new(content, lang);
            for cs in boundary_cut_offsets(content) {
                for scope in &scopes {
                    assert_eq!(
                        ctx.resolve_scope_range(cs, scope),
                        resolve_scope_range(content, cs, scope, lang),
                        "ctx/free-fn asymmetric mismatch for {scope:?} at char_start {cs} in {content:?}"
                    );
                }
                for scope in [Scope::Words(2), Scope::Sentence(1), Scope::Paragraph(1), Scope::Page(1), Scope::Section] {
                    for mode in [ResolutionMode::Backward, ResolutionMode::Bidirectional] {
                        assert_eq!(
                            ctx.resolve_scope_range_with_mode(cs, &scope, &mode),
                            resolve_scope_range_with_mode(content, cs, &scope, lang, &mode),
                            "ctx/free-fn mode mismatch for {scope:?}/{mode:?} at char_start {cs} in {content:?}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn ctx_extract_text_for_range_matches_free_fn() {
        let content = "你好世界 hello world 😀 end.";
        let ctx = ScopeResolveCtx::new(content, "en");
        for (start, end) in [(0usize, 2usize), (0, 4), (5, 10), (0, utf16_len(content))] {
            let range = ScopeRange { start, end };
            assert_eq!(
                ctx.extract_text_for_range(&range),
                extract_text_for_range(content, &range),
            );
        }
    }

    #[test]
    fn ctx_sentence_dispatch_uses_ctx_path() {
        // Scope::Sentence through the ctx dispatch must agree with the free fn.
        let content = "First one. The dog ran. The cat sat.<!--- n --->";
        let cs = utf16_len(&content[..content.find("<!---").unwrap()]);
        let ctx = ScopeResolveCtx::new(content, "en");
        assert_eq!(
            ctx.resolve_scope_range(cs, &Scope::Sentence(2)),
            resolve_scope_range(content, cs, &Scope::Sentence(2), "en"),
        );
    }
}
