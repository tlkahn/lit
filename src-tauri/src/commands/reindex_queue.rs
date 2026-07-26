//! Background coalescing queue for save-path reindexing.
//!
//! `write_page` (and `.bib` saves via `write_code_file`) schedule work here
//! instead of reindexing synchronously on the main thread. Rapid saves of the
//! same workspace coalesce into pending per-kind path sets that a single
//! drainer thread consumes, so a burst of autosaves costs one or two reindex
//! passes instead of one per save.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::graph::error::GraphError;
use crate::graph::indexer::DiffResult;

/// How a scheduled path changed — maps to the matching `DiffResult` bucket.
/// Production wiring currently only schedules `Changed` (saves); `New` and
/// `Deleted` complete the diff model for callers that migrate later.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    #[allow(dead_code)]
    New,
    Changed,
    #[allow(dead_code)]
    Deleted,
}

type Job = Box<dyn FnOnce() + Send + 'static>;
type Spawner = Arc<dyn Fn(Job) + Send + Sync>;

type RunResult = Result<Vec<(String, String)>, GraphError>;

#[derive(Default)]
struct Pending {
    new: HashSet<String>,
    changed: HashSet<String>,
    deleted: HashSet<String>,
    draining: bool,
}

impl Pending {
    fn add(&mut self, kind: ChangeKind, path: String) {
        match kind {
            ChangeKind::New => self.new.insert(path),
            ChangeKind::Changed => self.changed.insert(path),
            ChangeKind::Deleted => self.deleted.insert(path),
        };
    }

    fn is_empty(&self) -> bool {
        self.new.is_empty() && self.changed.is_empty() && self.deleted.is_empty()
    }

    fn take_diff(&mut self) -> DiffResult {
        let mut new: Vec<String> = self.new.drain().collect();
        let mut changed: Vec<String> = self.changed.drain().collect();
        let mut deleted: Vec<String> = self.deleted.drain().collect();
        new.sort();
        changed.sort();
        deleted.sort();
        DiffResult { new, changed, deleted }
    }
}

pub struct ReindexQueue {
    state: Mutex<HashMap<PathBuf, Pending>>,
    spawner: Spawner,
}

impl ReindexQueue {
    /// Production queue: drains on the Tauri blocking thread pool.
    pub fn new() -> Self {
        Self::with_spawner(Arc::new(|job: Job| {
            tauri::async_runtime::spawn_blocking(move || job());
        }))
    }

    /// Queue with a custom drainer spawner — lets tests use plain threads
    /// instead of the Tauri async runtime.
    pub fn with_spawner(spawner: Spawner) -> Self {
        Self {
            state: Mutex::new(HashMap::new()),
            spawner,
        }
    }

    /// Record `path` as pending under `key` and ensure a drainer is running.
    ///
    /// All schedules that land while a drain pass is in flight coalesce into
    /// the next pass, which reuses the `run`/`notify` of the call that started
    /// the drainer. Schedules for different keys drain independently.
    pub fn schedule<R, N>(
        self: &Arc<Self>,
        key: PathBuf,
        kind: ChangeKind,
        path: String,
        run: R,
        notify: N,
    ) where
        R: Fn(&DiffResult) -> RunResult + Send + 'static,
        N: Fn(&RunResult) + Send + 'static,
    {
        {
            let mut state = self.state.lock().unwrap();
            let pending = state.entry(key.clone()).or_default();
            pending.add(kind, path);
            if pending.draining {
                return;
            }
            pending.draining = true;
        }
        let this = Arc::clone(self);
        (self.spawner)(Box::new(move || this.drain(&key, run, notify)));
    }

    fn drain<R, N>(&self, key: &PathBuf, run: R, notify: N)
    where
        R: Fn(&DiffResult) -> RunResult,
        N: Fn(&RunResult),
    {
        // If `run` (or `notify`) panics, the unwind must clear `draining`,
        // otherwise no future schedule would ever spawn a drainer again.
        struct DrainGuard<'a> {
            queue: &'a ReindexQueue,
            key: &'a PathBuf,
        }
        impl Drop for DrainGuard<'_> {
            fn drop(&mut self) {
                if let Some(pending) = self.queue.state.lock().unwrap().get_mut(self.key) {
                    pending.draining = false;
                }
            }
        }
        let _guard = DrainGuard { queue: self, key };

        loop {
            let diff = {
                let mut state = self.state.lock().unwrap();
                let pending = state.get_mut(key).expect("drainer key must exist");
                if pending.is_empty() {
                    pending.draining = false;
                    return;
                }
                pending.take_diff()
            };
            let result = run(&diff);
            notify(&result);
        }
    }
}

/// Builds a drain-pass closure that re-reads annotation options on every
/// pass, so coalesced passes never run under options frozen at schedule time.
pub fn fresh_opts_run<O, R>(opts: O, reindex: R) -> impl Fn(&DiffResult) -> RunResult
where
    O: Fn() -> crate::annotation::lang::AnnotationIndexOpts + Send + 'static,
    R: Fn(&DiffResult, &crate::annotation::lang::AnnotationIndexOpts) -> RunResult + Send + 'static,
{
    move |diff| reindex(diff, &opts())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::time::Duration;

    fn thread_spawner() -> Spawner {
        Arc::new(|job: Job| {
            std::thread::spawn(move || job());
        })
    }

    #[test]
    fn drains_paths_enqueued_during_run() {
        let queue = Arc::new(ReindexQueue::with_spawner(thread_spawner()));
        let root = PathBuf::from("/ws");

        let diffs = Arc::new(Mutex::new(Vec::<DiffResult>::new()));
        let (started_tx, started_rx) = mpsc::channel::<()>();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let release_rx = Mutex::new(release_rx);
        let (done_tx, done_rx) = mpsc::channel::<()>();

        let seen = Arc::clone(&diffs);
        queue.schedule(
            root.clone(),
            ChangeKind::Changed,
            "a.md".to_string(),
            move |diff| {
                seen.lock().unwrap().push(diff.clone());
                started_tx.send(()).unwrap();
                release_rx.lock().unwrap().recv().unwrap();
                Ok(vec![])
            },
            move |_res| {
                done_tx.send(()).unwrap();
            },
        );

        started_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("first pass must start");

        // A different path arrives while the first pass is in flight.
        queue.schedule(
            root.clone(),
            ChangeKind::New,
            "b.md".to_string(),
            |_diff| Ok(vec![]),
            |_res| {},
        );

        release_tx.send(()).unwrap();
        done_rx.recv_timeout(Duration::from_secs(5)).expect("pass 1 notify");
        started_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("second pass must start for the mid-run path");
        release_tx.send(()).unwrap();
        done_rx.recv_timeout(Duration::from_secs(5)).expect("pass 2 notify");

        let seen = diffs.lock().unwrap();
        assert_eq!(seen.len(), 2);
        assert_eq!(seen[0].changed, vec!["a.md".to_string()]);
        assert_eq!(seen[1].new, vec!["b.md".to_string()], "mid-run path must be drained in pass 2");
        assert!(seen[1].changed.is_empty());
    }

    #[test]
    fn error_in_run_notifies_and_queue_stays_usable() {
        let queue = Arc::new(ReindexQueue::with_spawner(thread_spawner()));
        let root = PathBuf::from("/ws");

        let (err_tx, err_rx) = mpsc::channel::<bool>();
        queue.schedule(
            root.clone(),
            ChangeKind::Changed,
            "a.md".to_string(),
            |_diff| Err(GraphError::Other("boom".into())),
            move |res| {
                err_tx.send(res.is_err()).unwrap();
            },
        );
        let notified_err = err_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("notify must fire even when run errors");
        assert!(notified_err, "notify must see the Err");

        // The queue must still drain subsequent schedules. A schedule can
        // race the exiting drainer (and be consumed by the old run/notify),
        // so retry until a fresh drainer picks the path up.
        let (ok_tx, ok_rx) = mpsc::channel::<bool>();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut notified_ok = false;
        while std::time::Instant::now() < deadline {
            let ok_tx = ok_tx.clone();
            queue.schedule(
                root.clone(),
                ChangeKind::Changed,
                "b.md".to_string(),
                |_diff| Ok(vec![]),
                move |res| {
                    let _ = ok_tx.send(res.is_ok());
                },
            );
            if let Ok(true) = ok_rx.recv_timeout(Duration::from_millis(100)) {
                notified_ok = true;
                break;
            }
        }
        assert!(notified_ok, "queue must stay usable after an error");
    }

    #[test]
    fn panic_in_run_resets_draining() {
        let queue = Arc::new(ReindexQueue::with_spawner(thread_spawner()));
        let root = PathBuf::from("/ws");

        let (started_tx, started_rx) = mpsc::channel::<()>();
        queue.schedule(
            root.clone(),
            ChangeKind::Changed,
            "a.md".to_string(),
            move |_diff| {
                started_tx.send(()).unwrap();
                panic!("reindex blew up");
            },
            |_res| {},
        );
        started_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("panicking pass must start");

        // After the panic unwinds, the queue must accept and drain new work.
        let (ok_tx, ok_rx) = mpsc::channel::<()>();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut drained = false;
        while std::time::Instant::now() < deadline {
            let ok_tx = ok_tx.clone();
            queue.schedule(
                root.clone(),
                ChangeKind::Changed,
                "b.md".to_string(),
                |_diff| Ok(vec![]),
                move |_res| {
                    let _ = ok_tx.send(());
                },
            );
            if ok_rx.recv_timeout(Duration::from_millis(100)).is_ok() {
                drained = true;
                break;
            }
        }
        assert!(drained, "a panicking run must not wedge the queue");
    }

    #[test]
    fn multiple_roots_drain_independently() {
        let queue = Arc::new(ReindexQueue::with_spawner(thread_spawner()));
        let root_a = PathBuf::from("/ws-a");
        let root_b = PathBuf::from("/ws-b");

        // Block root A's drainer mid-run.
        let (started_tx, started_rx) = mpsc::channel::<()>();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let release_rx = Mutex::new(release_rx);
        queue.schedule(
            root_a,
            ChangeKind::Changed,
            "a.md".to_string(),
            move |_diff| {
                started_tx.send(()).unwrap();
                release_rx.lock().unwrap().recv().unwrap();
                Ok(vec![])
            },
            |_res| {},
        );
        started_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("root A pass must start");

        // Root B must drain while A is still blocked.
        let (done_b_tx, done_b_rx) = mpsc::channel::<()>();
        queue.schedule(
            root_b,
            ChangeKind::Changed,
            "b.md".to_string(),
            |_diff| Ok(vec![]),
            move |_res| {
                done_b_tx.send(()).unwrap();
            },
        );
        done_b_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("root B must drain while root A is blocked");

        release_tx.send(()).unwrap();
    }

    #[test]
    fn coalesces_rapid_schedules_into_single_pass() {
        let queue = Arc::new(ReindexQueue::with_spawner(thread_spawner()));
        let root = PathBuf::from("/ws");

        let run_count = Arc::new(AtomicUsize::new(0));
        let (started_tx, started_rx) = mpsc::channel::<()>();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let release_rx = Mutex::new(release_rx);
        let (done_tx, done_rx) = mpsc::channel::<()>();

        let rc = Arc::clone(&run_count);
        queue.schedule(
            root.clone(),
            ChangeKind::Changed,
            "a.md".to_string(),
            move |_diff| {
                rc.fetch_add(1, Ordering::SeqCst);
                started_tx.send(()).unwrap();
                release_rx.lock().unwrap().recv().unwrap();
                Ok(vec![])
            },
            move |_res| {
                done_tx.send(()).unwrap();
            },
        );

        // Drainer is now blocked inside the first run pass.
        started_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("first run pass must start");

        // Nine more rapid saves of the same path — all must coalesce.
        for _ in 0..9 {
            queue.schedule(
                root.clone(),
                ChangeKind::Changed,
                "a.md".to_string(),
                |_diff| Ok(vec![]),
                |_res| {},
            );
        }

        // Release the first pass; the coalesced batch runs as pass two.
        release_tx.send(()).unwrap();
        done_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("first pass must notify");
        started_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("coalesced second pass must start");
        release_tx.send(()).unwrap();
        done_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("second pass must notify");

        assert_eq!(
            run_count.load(Ordering::SeqCst),
            2,
            "10 rapid schedules must coalesce into exactly 2 run passes"
        );
    }

    #[test]
    fn run_closure_observes_opts_changed_between_coalesced_passes() {
        use crate::annotation::lang::AnnotationIndexOpts;

        let queue = Arc::new(ReindexQueue::with_spawner(thread_spawner()));
        let root = PathBuf::from("/ws");

        let shared_opts = Arc::new(Mutex::new(
            AnnotationIndexOpts::with_lang("en"),
        ));
        let recorded_langs = Arc::new(Mutex::new(Vec::<String>::new()));

        let (started_tx, started_rx) = mpsc::channel::<()>();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let release_rx = Mutex::new(release_rx);
        let (done_tx, done_rx) = mpsc::channel::<()>();

        let opts_for_run = Arc::clone(&shared_opts);
        let langs = Arc::clone(&recorded_langs);
        queue.schedule(
            root.clone(),
            ChangeKind::Changed,
            "a.md".to_string(),
            fresh_opts_run(
                move || opts_for_run.lock().unwrap().clone(),
                move |_diff, ann| {
                    langs.lock().unwrap().push(ann.default_lang.clone());
                    started_tx.send(()).unwrap();
                    release_rx.lock().unwrap().recv().unwrap();
                    Ok(vec![])
                },
            ),
            move |_res| {
                done_tx.send(()).unwrap();
            },
        );

        started_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("first pass must start");

        *shared_opts.lock().unwrap() = AnnotationIndexOpts::with_lang("fr");
        queue.schedule(
            root.clone(),
            ChangeKind::Changed,
            "a.md".to_string(),
            |_diff| Ok(vec![]),
            |_res| {},
        );

        release_tx.send(()).unwrap();
        done_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("pass 1 notify");
        started_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("coalesced second pass must start");
        release_tx.send(()).unwrap();
        done_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("pass 2 notify");

        let langs = recorded_langs.lock().unwrap();
        assert_eq!(
            *langs,
            vec!["en".to_string(), "fr".to_string()],
            "each drain pass must re-read opts, not reuse the frozen schedule-time value"
        );
    }
}
