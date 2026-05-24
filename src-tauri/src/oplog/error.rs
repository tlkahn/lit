#[derive(Debug, thiserror::Error)]
pub enum OpLogError {
    #[error("nothing to undo")]
    NothingToUndo,

    #[error("database error: {message}")]
    Database { message: String },

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

impl From<rusqlite::Error> for OpLogError {
    fn from(e: rusqlite::Error) -> Self {
        OpLogError::Database {
            message: e.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_to_undo_error_displays_message() {
        let err = OpLogError::NothingToUndo;
        assert_eq!(err.to_string(), "nothing to undo");
    }

    #[test]
    fn database_error_displays_message() {
        let err = OpLogError::Database {
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
        let err: OpLogError = sqlite_err.into();
        match &err {
            OpLogError::Database { message } => assert!(message.contains("test")),
            _ => panic!("expected Database variant"),
        }
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "gone");
        let err: OpLogError = io_err.into();
        match &err {
            OpLogError::Io(e) => assert_eq!(e.kind(), std::io::ErrorKind::NotFound),
            _ => panic!("expected Io variant"),
        }
    }
}
