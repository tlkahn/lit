pub mod frontmatter;
pub mod frontmatter_merge;
pub mod merge;
pub mod normalize;
pub mod ops;
pub mod page;
pub mod scan;
pub mod split;
pub mod split_execute;
pub mod trash;
pub mod watcher;
pub mod write_hash;

use serde::Serialize;
use std::fmt;

#[derive(Debug, Serialize)]
pub enum WorkspaceError {
    NotOpen,
    InvalidPath(String),
    InvalidPageName(String),
    PageNotFound(String),
    PageAlreadyExists(String),
    TrashEntryNotFound(String),
    RestoreConflict(String),
    IoError(String),
    ParseError(String),
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WorkspaceError::NotOpen => write!(f, "No workspace is open"),
            WorkspaceError::InvalidPath(p) => write!(f, "Invalid path: {p}"),
            WorkspaceError::InvalidPageName(n) => write!(f, "Invalid page name: {n}"),
            WorkspaceError::PageNotFound(p) => write!(f, "Page not found: {p}"),
            WorkspaceError::PageAlreadyExists(p) => write!(f, "Page already exists: {p}"),
            WorkspaceError::TrashEntryNotFound(n) => write!(f, "Trash entry not found: {n}"),
            WorkspaceError::RestoreConflict(p) => write!(f, "Cannot restore, file already exists: {p}"),
            WorkspaceError::IoError(e) => write!(f, "IO error: {e}"),
            WorkspaceError::ParseError(e) => write!(f, "Parse error: {e}"),
        }
    }
}

impl From<std::io::Error> for WorkspaceError {
    fn from(e: std::io::Error) -> Self {
        WorkspaceError::IoError(e.to_string())
    }
}
