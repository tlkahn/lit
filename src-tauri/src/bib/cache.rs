use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

use crate::bib::types::BibEntry;

struct CacheEntry {
    entries: Vec<BibEntry>,
    mtime: SystemTime,
}

pub struct BibCache {
    store: Mutex<HashMap<PathBuf, CacheEntry>>,
    index_cache: Mutex<Option<HashMap<String, crate::bib::types::BibEntry>>>,
}

impl BibCache {
    pub fn new() -> Self {
        Self {
            store: Mutex::new(HashMap::new()),
            index_cache: Mutex::new(None),
        }
    }

    pub fn mark_index_dirty(&self) {
        *self.index_cache.lock().unwrap() = None;
    }

    pub fn get_cached_index(&self) -> Option<HashMap<String, crate::bib::types::BibEntry>> {
        self.index_cache.lock().unwrap().clone()
    }

    /// Look up a single entry from the cached index without cloning the
    /// entire `HashMap`.  Returns `None` when the cache is cold or dirty
    /// (caller should fall back to `build_bib_index`).
    pub fn get_entry(&self, key: &str) -> Option<BibEntry> {
        let guard = self.index_cache.lock().unwrap();
        guard.as_ref().and_then(|idx| idx.get(key).cloned())
    }

    pub fn set_cached_index(&self, index: HashMap<String, crate::bib::types::BibEntry>) {
        *self.index_cache.lock().unwrap() = Some(index);
    }

    pub fn get_or_parse(
        &self,
        path: &PathBuf,
        content: &str,
        mtime: SystemTime,
    ) -> Vec<BibEntry> {
        self.get_or_parse_with(path, mtime, || Some(content.to_owned()))
    }

    /// Like [`get_or_parse`], but reads the file content lazily: `load_content`
    /// is invoked ONLY on a cache miss, so warm-cache hits perform zero I/O.
    ///
    /// If `load_content` returns `None` (read failure / non-UTF8), an empty
    /// `Vec` is returned and nothing is cached — preserving the caller's
    /// skip-on-read-failure behavior (a transiently unreadable file is not
    /// poisoned with an empty cached result).
    pub fn get_or_parse_with(
        &self,
        path: &PathBuf,
        mtime: SystemTime,
        load_content: impl FnOnce() -> Option<String>,
    ) -> Vec<BibEntry> {
        let mut store = self.store.lock().unwrap();
        if let Some(cached) = store.get(path) {
            if cached.mtime == mtime {
                return cached.entries.clone();
            }
        }

        let content = match load_content() {
            Some(c) => c,
            None => return Vec::new(),
        };

        let entries = crate::bib::parser::parse_bibtex(&content);
        store.insert(
            path.clone(),
            CacheEntry {
                entries: entries.clone(),
                mtime,
            },
        );
        entries
    }

    pub fn invalidate(&self, path: &PathBuf) {
        self.store.lock().unwrap().remove(path);
        self.mark_index_dirty();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_bib() -> &'static str {
        "@article{test2020,\n  author = {Smith, John},\n  title = {Test},\n  year = {2020}\n}"
    }

    #[test]
    fn get_or_parse_caches_result() {
        let cache = BibCache::new();
        let path = PathBuf::from("/tmp/test.bib");
        let mtime = SystemTime::UNIX_EPOCH;

        let result1 = cache.get_or_parse(&path, sample_bib(), mtime);
        assert_eq!(result1.len(), 1);
        assert_eq!(result1[0].key, "test2020");

        let result2 = cache.get_or_parse(&path, "", mtime);
        assert_eq!(result2.len(), 1, "should return cached result, not re-parse empty string");
    }

    #[test]
    fn get_or_parse_invalidates_on_mtime_change() {
        let cache = BibCache::new();
        let path = PathBuf::from("/tmp/test.bib");
        let mtime1 = SystemTime::UNIX_EPOCH;
        let mtime2 = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1);

        cache.get_or_parse(&path, sample_bib(), mtime1);

        let result = cache.get_or_parse(&path, "", mtime2);
        assert!(result.is_empty(), "should re-parse with new mtime");
    }

    #[test]
    fn get_or_parse_with_skips_loader_on_warm_cache() {
        let cache = BibCache::new();
        let path = PathBuf::from("/tmp/test.bib");
        let mtime = SystemTime::UNIX_EPOCH;

        let result1 = cache.get_or_parse_with(&path, mtime, || Some(sample_bib().to_string()));
        assert_eq!(result1.len(), 1);

        let mut called = false;
        let result2 = cache.get_or_parse_with(&path, mtime, || {
            called = true;
            Some(String::new())
        });
        assert!(!called, "loader must not run on warm cache");
        assert_eq!(result2.len(), 1, "should return cached result");
    }

    #[test]
    fn get_or_parse_with_runs_loader_on_mtime_change() {
        let cache = BibCache::new();
        let path = PathBuf::from("/tmp/test.bib");
        let mtime1 = SystemTime::UNIX_EPOCH;
        let mtime2 = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1);

        cache.get_or_parse_with(&path, mtime1, || Some(sample_bib().to_string()));

        let mut called = false;
        let result = cache.get_or_parse_with(&path, mtime2, || {
            called = true;
            Some(String::new())
        });
        assert!(called, "loader must run on mtime change");
        assert!(result.is_empty(), "should re-parse with new (empty) content");
    }

    #[test]
    fn get_or_parse_with_none_loader_returns_empty_and_does_not_cache() {
        let cache = BibCache::new();
        let path = PathBuf::from("/tmp/test.bib");
        let mtime = SystemTime::UNIX_EPOCH;

        let result = cache.get_or_parse_with(&path, mtime, || None);
        assert!(result.is_empty(), "None loader yields empty result");

        // A None (read-failure) result must NOT be cached: a subsequent call at the
        // same mtime with a working loader must still run the loader and parse.
        let mut called = false;
        let result2 = cache.get_or_parse_with(&path, mtime, || {
            called = true;
            Some(sample_bib().to_string())
        });
        assert!(called, "loader must run since None result was not cached");
        assert_eq!(result2.len(), 1);
    }

    #[test]
    fn invalidate_removes_entry() {
        let cache = BibCache::new();
        let path = PathBuf::from("/tmp/test.bib");
        let mtime = SystemTime::UNIX_EPOCH;

        cache.get_or_parse(&path, sample_bib(), mtime);
        cache.invalidate(&path);

        let result = cache.get_or_parse(&path, "", mtime);
        assert!(result.is_empty(), "should re-parse after invalidation");
    }

    // --- index_cache tests ---

    #[test]
    fn index_cache_starts_empty() {
        let cache = BibCache::new();
        assert!(cache.get_cached_index().is_none(), "fresh BibCache must have no cached index");
    }

    #[test]
    fn index_cache_returns_cached_result() {
        let cache = BibCache::new();
        let mut index = HashMap::new();
        index.insert("smith2024".to_string(), BibEntry {
            key: "smith2024".to_string(),
            entry_type: "article".to_string(),
            title: "Alpha".to_string(),
            authors: vec!["Smith, John".to_string()],
            year: "2024".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: None,
            journal: None,
            url: None,
            file: None,
            volume: None,
            number: None,
            pages: None,
            publisher: None,
            issn: None,
            isbn: None,
            tags: vec![]
        });
        cache.set_cached_index(index.clone());
        let cached = cache.get_cached_index();
        assert!(cached.is_some(), "should return cached index");
        let cached = cached.unwrap();
        assert_eq!(cached.len(), 1);
        assert!(cached.contains_key("smith2024"));
    }

    #[test]
    fn mark_index_dirty_clears_cache() {
        let cache = BibCache::new();
        let mut index = HashMap::new();
        index.insert("smith2024".to_string(), BibEntry {
            key: "smith2024".to_string(),
            entry_type: "article".to_string(),
            title: "Alpha".to_string(),
            authors: vec!["Smith, John".to_string()],
            year: "2024".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: None,
            journal: None,
            url: None,
            file: None,
            volume: None,
            number: None,
            pages: None,
            publisher: None,
            issn: None,
            isbn: None,
            tags: vec![]
        });
        cache.set_cached_index(index);
        cache.mark_index_dirty();
        assert!(cache.get_cached_index().is_none(), "cache should be None after mark_index_dirty");
    }

    // --- get_entry tests ---

    #[test]
    fn get_entry_returns_none_when_cold() {
        let cache = BibCache::new();
        assert!(cache.get_entry("smith2024").is_none(), "cold cache must return None");
    }

    #[test]
    fn get_entry_returns_entry_when_warm() {
        let cache = BibCache::new();
        let mut index = HashMap::new();
        index.insert("smith2024".to_string(), BibEntry {
            key: "smith2024".to_string(),
            entry_type: "article".to_string(),
            title: "Alpha".to_string(),
            authors: vec!["Smith, John".to_string()],
            year: "2024".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: None,
            journal: None,
            url: None,
            file: None,
            volume: None,
            number: None,
            pages: None,
            publisher: None,
            issn: None,
            isbn: None,
            tags: vec![],
        });
        cache.set_cached_index(index);
        let result = cache.get_entry("smith2024");
        assert!(result.is_some(), "warm cache should return the entry");
        assert_eq!(result.unwrap().key, "smith2024");
    }

    #[test]
    fn get_entry_returns_none_for_missing_key() {
        let cache = BibCache::new();
        let mut index = HashMap::new();
        index.insert("smith2024".to_string(), BibEntry {
            key: "smith2024".to_string(),
            entry_type: "article".to_string(),
            title: "Alpha".to_string(),
            authors: vec!["Smith, John".to_string()],
            year: "2024".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: None,
            journal: None,
            url: None,
            file: None,
            volume: None,
            number: None,
            pages: None,
            publisher: None,
            issn: None,
            isbn: None,
            tags: vec![],
        });
        cache.set_cached_index(index);
        assert!(cache.get_entry("nonexistent").is_none(), "missing key must return None");
    }

    #[test]
    fn get_entry_returns_none_after_dirty() {
        let cache = BibCache::new();
        let mut index = HashMap::new();
        index.insert("smith2024".to_string(), BibEntry {
            key: "smith2024".to_string(),
            entry_type: "article".to_string(),
            title: "Alpha".to_string(),
            authors: vec!["Smith, John".to_string()],
            year: "2024".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: None,
            journal: None,
            url: None,
            file: None,
            volume: None,
            number: None,
            pages: None,
            publisher: None,
            issn: None,
            isbn: None,
            tags: vec![],
        });
        cache.set_cached_index(index);
        cache.mark_index_dirty();
        assert!(cache.get_entry("smith2024").is_none(), "dirty cache must return None");
    }

    #[test]
    fn invalidate_also_clears_index_cache() {
        let cache = BibCache::new();
        let path = PathBuf::from("/tmp/test.bib");
        let mtime = SystemTime::UNIX_EPOCH;

        // Populate per-file cache
        cache.get_or_parse(&path, sample_bib(), mtime);

        // Populate index cache
        let mut index = HashMap::new();
        index.insert("test2020".to_string(), BibEntry {
            key: "test2020".to_string(),
            entry_type: "article".to_string(),
            title: "Test".to_string(),
            authors: vec!["Smith, John".to_string()],
            year: "2020".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: None,
            journal: None,
            url: None,
            file: None,
            volume: None,
            number: None,
            pages: None,
            publisher: None,
            issn: None,
            isbn: None,
            tags: vec![]
        });
        cache.set_cached_index(index);

        // invalidate a file should also clear the index cache
        cache.invalidate(&path);
        assert!(cache.get_cached_index().is_none(), "invalidate must also clear index cache");
    }
}
