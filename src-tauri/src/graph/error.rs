use std::path::PathBuf;

pub const NODE_NOT_FOUND_PREFIX: &str = "node not found:";

#[derive(Debug, thiserror::Error)]
pub enum GraphError {
    #[error("database error: {message}")]
    Database { message: String },

    #[error("node not found: {id}")]
    NodeNotFound { id: String },

    #[error("I/O error at {path}: {source}")]
    Io {
        source: std::io::Error,
        path: PathBuf,
    },

    #[error("{0}")]
    Other(String),
}

impl From<rusqlite::Error> for GraphError {
    fn from(e: rusqlite::Error) -> Self {
        GraphError::Database {
            message: e.to_string(),
        }
    }
}

impl From<serde_json::Error> for GraphError {
    fn from(e: serde_json::Error) -> Self {
        GraphError::Other(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_error_displays_message() {
        let err = GraphError::Database {
            message: "table not found".into(),
        };
        assert_eq!(err.to_string(), "database error: table not found");
    }

    #[test]
    fn from_rusqlite_error() {
        let sqlite_err = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(1),
            Some("test".into()),
        );
        let err: GraphError = sqlite_err.into();
        match &err {
            GraphError::Database { message } => assert!(message.contains("test")),
            _ => panic!("expected Database variant"),
        }
    }

    #[test]
    fn node_not_found_displays_id() {
        let err = GraphError::NodeNotFound {
            id: "some-node".into(),
        };
        assert_eq!(err.to_string(), "node not found: some-node");
    }

    #[test]
    fn from_serde_json_error() {
        let serde_err = serde_json::from_str::<String>("not valid json").unwrap_err();
        let err: GraphError = serde_err.into();
        match &err {
            GraphError::Other(msg) => assert!(!msg.is_empty()),
            _ => panic!("expected Other variant, got: {err:?}"),
        }
    }

    #[test]
    fn node_not_found_starts_with_prefix_constant() {
        let err = GraphError::NodeNotFound {
            id: "test-node".into(),
        };
        assert!(err.to_string().starts_with(NODE_NOT_FOUND_PREFIX));
    }

    #[test]
    fn io_error_displays_path() {
        let err = GraphError::Io {
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "gone"),
            path: PathBuf::from("/some/file.md"),
        };
        let msg = err.to_string();
        assert!(msg.contains("/some/file.md"));
        assert!(msg.contains("gone"));
    }
}
