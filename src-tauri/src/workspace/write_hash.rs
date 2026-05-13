use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct WriteHashRegistry {
    hashes: Mutex<HashMap<PathBuf, u64>>,
}

impl WriteHashRegistry {
    pub fn new() -> Self {
        Self {
            hashes: Mutex::new(HashMap::new()),
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
}
