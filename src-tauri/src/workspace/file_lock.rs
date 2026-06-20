use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub struct FilePathLock {
    locks: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
}

impl FilePathLock {
    pub fn new() -> Self {
        Self {
            locks: Mutex::new(HashMap::new()),
        }
    }

    pub fn with_lock<F, R>(&self, path: &Path, f: F) -> R
    where
        F: FnOnce() -> R,
    {
        let per_path = {
            let mut map = self.locks.lock().unwrap();
            map.entry(path.to_path_buf())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let _guard = per_path.lock().unwrap();
        f()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Barrier;

    #[test]
    fn same_path_serializes() {
        let lock = Arc::new(FilePathLock::new());
        let barrier = Arc::new(Barrier::new(2));
        let counter = Arc::new(AtomicUsize::new(0));
        let max_concurrent = Arc::new(AtomicUsize::new(0));

        let handles: Vec<_> = (0..2)
            .map(|_| {
                let lock = lock.clone();
                let barrier = barrier.clone();
                let counter = counter.clone();
                let max_concurrent = max_concurrent.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    lock.with_lock(Path::new("/tmp/same.md"), || {
                        let prev = counter.fetch_add(1, Ordering::SeqCst);
                        max_concurrent.fetch_max(prev + 1, Ordering::SeqCst);
                        std::thread::sleep(std::time::Duration::from_millis(50));
                        counter.fetch_sub(1, Ordering::SeqCst);
                    });
                })
            })
            .collect();

        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(max_concurrent.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn different_paths_do_not_block() {
        let lock = Arc::new(FilePathLock::new());
        let barrier = Arc::new(Barrier::new(2));
        let counter = Arc::new(AtomicUsize::new(0));
        let max_concurrent = Arc::new(AtomicUsize::new(0));

        let paths = ["/tmp/a.md", "/tmp/b.md"];
        let handles: Vec<_> = paths
            .iter()
            .map(|p| {
                let lock = lock.clone();
                let barrier = barrier.clone();
                let counter = counter.clone();
                let max_concurrent = max_concurrent.clone();
                let path = PathBuf::from(p);
                std::thread::spawn(move || {
                    barrier.wait();
                    lock.with_lock(&path, || {
                        let prev = counter.fetch_add(1, Ordering::SeqCst);
                        max_concurrent.fetch_max(prev + 1, Ordering::SeqCst);
                        std::thread::sleep(std::time::Duration::from_millis(50));
                        counter.fetch_sub(1, Ordering::SeqCst);
                    });
                })
            })
            .collect();

        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(max_concurrent.load(Ordering::SeqCst), 2);
    }
}
