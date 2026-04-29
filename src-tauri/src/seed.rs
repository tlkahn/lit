use std::sync::{Condvar, Mutex};

pub struct SeedState {
    ready: Mutex<bool>,
    condvar: Condvar,
}

impl SeedState {
    pub fn new() -> Self {
        Self {
            ready: Mutex::new(false),
            condvar: Condvar::new(),
        }
    }

    pub fn mark_ready(&self) {
        let mut ready = self.ready.lock().unwrap();
        *ready = true;
        self.condvar.notify_all();
    }

    pub fn wait_ready(&self) {
        let mut ready = self.ready.lock().unwrap();
        while !*ready {
            ready = self.condvar.wait(ready).unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn new_state_is_not_ready() {
        let state = SeedState::new();
        let ready = state.ready.lock().unwrap();
        assert!(!*ready);
    }

    #[test]
    fn mark_ready_sets_flag() {
        let state = SeedState::new();
        state.mark_ready();
        let ready = state.ready.lock().unwrap();
        assert!(*ready);
    }

    #[test]
    fn wait_ready_returns_immediately_when_ready() {
        let state = SeedState::new();
        state.mark_ready();
        state.wait_ready();
    }

    #[test]
    fn wait_ready_blocks_until_mark_ready() {
        let state = Arc::new(SeedState::new());
        let state2 = Arc::clone(&state);

        let handle = thread::spawn(move || {
            state2.wait_ready();
        });

        thread::sleep(Duration::from_millis(50));
        assert!(!handle.is_finished());

        state.mark_ready();
        handle.join().unwrap();
    }
}
