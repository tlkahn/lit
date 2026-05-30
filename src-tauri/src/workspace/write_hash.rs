use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct WriteHashRegistry {
    hashes: Mutex<HashMap<PathBuf, u64>>,
    pending_deletes: Mutex<HashSet<PathBuf>>,
}

impl WriteHashRegistry {
    pub fn new() -> Self {
        Self {
            hashes: Mutex::new(HashMap::new()),
            pending_deletes: Mutex::new(HashSet::new()),
        }
    }

    pub fn record(&self, path: &std::path::Path, content: &str) {
        let hash = compute_hash(content);
        self.hashes.lock().unwrap().insert(path.to_path_buf(), hash);
    }

    pub fn check(&self, path: &std::path::Path, content: &str) -> bool {
        let hash = compute_hash(content);
        let map = self.hashes.lock().unwrap();
        match map.get(path) {
            Some(&recorded) => recorded == hash,
            None => false,
        }
    }

    pub fn record_delete(&self, path: &std::path::Path) {
        self.hashes.lock().unwrap().remove(path);
        self.pending_deletes.lock().unwrap().insert(path.to_path_buf());
    }

    pub fn consume_delete(&self, path: &std::path::Path) -> bool {
        self.pending_deletes.lock().unwrap().remove(path)
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
    fn record_delete_clears_stale_hash() {
        let registry = WriteHashRegistry::new();
        let path = Path::new("test.md");
        registry.record(path, "hello world");
        assert!(registry.check(path, "hello world"));
        registry.record_delete(path);
        assert!(!registry.check(path, "hello world"));
    }
}
