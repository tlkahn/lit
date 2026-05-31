use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::Mutex;

struct WriteHashInner {
    hashes: HashMap<PathBuf, u64>,
    pending_deletes: HashSet<PathBuf>,
}

pub struct WriteHashRegistry {
    inner: Mutex<WriteHashInner>,
}

impl WriteHashRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(WriteHashInner {
                hashes: HashMap::new(),
                pending_deletes: HashSet::new(),
            }),
        }
    }

    pub fn record(&self, path: &std::path::Path, content: &str) {
        let hash = compute_hash(content);
        self.inner.lock().unwrap().hashes.insert(path.to_path_buf(), hash);
    }

    pub fn check(&self, path: &std::path::Path, content: &str) -> bool {
        let hash = compute_hash(content);
        let inner = self.inner.lock().unwrap();
        match inner.hashes.get(path) {
            Some(&recorded) => recorded == hash,
            None => false,
        }
    }

    pub fn record_delete(&self, path: &std::path::Path) {
        let mut inner = self.inner.lock().unwrap();
        inner.hashes.remove(path);
        inner.pending_deletes.insert(path.to_path_buf());
    }

    pub fn consume_delete(&self, path: &std::path::Path) -> bool {
        self.inner.lock().unwrap().pending_deletes.remove(path)
    }
}

fn compute_hash(content: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn record_then_check_matching_hash() {
        let registry = WriteHashRegistry::new();
        let path = Path::new("test.md");
        registry.record(path, "hello world");
        assert!(registry.check(path, "hello world"));
    }

    #[test]
    fn check_different_content() {
        let registry = WriteHashRegistry::new();
        let path = Path::new("test.md");
        registry.record(path, "hello world");
        assert!(!registry.check(path, "different content"));
    }

    #[test]
    fn check_no_record() {
        let registry = WriteHashRegistry::new();
        let path = Path::new("unknown.md");
        assert!(!registry.check(path, "anything"));
    }

    #[test]
    fn check_without_clearing_matching_hash() {
        let registry = WriteHashRegistry::new();
        let path = Path::new("test.md");
        registry.record(path, "hello world");
        assert!(registry.check(path, "hello world"));
        assert!(registry.check(path, "hello world"));
    }

    #[test]
    fn record_delete_then_consume_returns_true() {
        let registry = WriteHashRegistry::new();
        let path = Path::new("test.md");
        registry.record_delete(path);
        assert!(registry.consume_delete(path));
    }

    #[test]
    fn consume_delete_without_record_returns_false() {
        let registry = WriteHashRegistry::new();
        let path = Path::new("unknown.md");
        assert!(!registry.consume_delete(path));
    }

    #[test]
    fn consume_delete_is_one_shot() {
        let registry = WriteHashRegistry::new();
        let path = Path::new("test.md");
        registry.record_delete(path);
        assert!(registry.consume_delete(path));
        assert!(!registry.consume_delete(path));
    }

    #[test]
    fn record_delete_is_atomic() {
        let registry = WriteHashRegistry::new();
        let path = Path::new("test.md");
        registry.record(path, "hello world");
        registry.record_delete(path);
        let inner = registry.inner.lock().unwrap();
        assert!(!inner.hashes.contains_key(path));
        assert!(inner.pending_deletes.contains(path));
    }

    #[test]
    fn record_delete_clears_stale_hash() {
        let registry = WriteHashRegistry::new();
        let path = Path::new("test.md");
        registry.record(path, "hello world");
        assert!(registry.check(path, "hello world"));
        registry.record_delete(path);
        assert!(!registry.check(path, "hello world"));
    }
}
