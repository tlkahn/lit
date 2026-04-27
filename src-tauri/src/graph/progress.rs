use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IndexPhase {
    Scanning,
    Parsing,
    Resolving,
    Diffing,
    Building,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexProgress {
    pub phase: IndexPhase,
    pub current: usize,
    pub total: usize,
}

pub type ProgressCallback = Box<dyn Fn(IndexProgress) + Send + 'static>;

pub fn noop_callback() -> ProgressCallback {
    Box::new(|_| {})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_serializes_to_snake_case() {
        assert_eq!(
            serde_json::to_value(IndexPhase::Scanning).unwrap(),
            serde_json::json!("scanning")
        );
        assert_eq!(
            serde_json::to_value(IndexPhase::Parsing).unwrap(),
            serde_json::json!("parsing")
        );
        assert_eq!(
            serde_json::to_value(IndexPhase::Resolving).unwrap(),
            serde_json::json!("resolving")
        );
        assert_eq!(
            serde_json::to_value(IndexPhase::Diffing).unwrap(),
            serde_json::json!("diffing")
        );
        assert_eq!(
            serde_json::to_value(IndexPhase::Building).unwrap(),
            serde_json::json!("building")
        );
    }

    #[test]
    fn progress_serializes_to_json() {
        let progress = IndexProgress {
            phase: IndexPhase::Parsing,
            current: 3,
            total: 10,
        };
        let json = serde_json::to_value(&progress).unwrap();
        assert_eq!(json["phase"], "parsing");
        assert_eq!(json["current"], 3);
        assert_eq!(json["total"], 10);
    }

    #[test]
    fn phases_are_ordered() {
        assert!(IndexPhase::Scanning < IndexPhase::Parsing);
        assert!(IndexPhase::Parsing < IndexPhase::Resolving);
        assert!(IndexPhase::Resolving < IndexPhase::Diffing);
        assert!(IndexPhase::Diffing < IndexPhase::Building);
    }
}
