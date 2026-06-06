use std::path::Path;

use serde::{Deserialize, Serialize};

use super::error::LicenseError;

const LICENSE_FILE: &str = "license.key";
const REVOCATION_FILE: &str = "revocation.json";

/// Local marker persisted when the server reports a license as revoked.
///
/// The key file is deleted on revocation (enforcement), but this marker lets
/// `get_status` report a revocation-specific state so the UI can explain what
/// happened instead of showing the generic "requires a license" splash.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RevocationMarker {
    #[serde(default)]
    pub reason: Option<String>,
}

/// Persist a revocation marker carrying the server-provided reason (if any).
pub fn write_revocation_marker(dir: &Path, reason: Option<&str>) -> Result<(), LicenseError> {
    std::fs::create_dir_all(dir)?;
    let marker = RevocationMarker {
        reason: reason.map(|s| s.to_string()),
    };
    let json = serde_json::to_string_pretty(&marker)
        .map_err(|e| LicenseError::InvalidKeyFormat(e.to_string()))?;
    let path = dir.join(REVOCATION_FILE);
    std::fs::write(&path, json).map_err(|e| LicenseError::Io {
        source: e,
        path: path.clone(),
    })
}

/// Read the revocation marker. Returns `None` if missing or corrupt
/// (mirrors `online::read_last_checked`).
pub fn read_revocation_marker(dir: &Path) -> Option<RevocationMarker> {
    let path = dir.join(REVOCATION_FILE);
    let contents = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

/// Remove the revocation marker. `Ok` if it was already absent
/// (mirrors `remove_license_key`).
pub fn clear_revocation_marker(dir: &Path) -> Result<(), LicenseError> {
    let path = dir.join(REVOCATION_FILE);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(LicenseError::Io {
            source: e,
            path: path.clone(),
        }),
    }
}

pub fn write_license_key(dir: &Path, pem: &str) -> Result<(), LicenseError> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(LICENSE_FILE);
    std::fs::write(&path, pem).map_err(|e| LicenseError::Io {
        source: e,
        path: path.clone(),
    })
}

pub fn read_license_key(dir: &Path) -> Result<Option<String>, LicenseError> {
    let path = dir.join(LICENSE_FILE);
    match std::fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(LicenseError::Io {
            source: e,
            path: path.clone(),
        }),
    }
}

pub fn remove_license_key(dir: &Path) -> Result<(), LicenseError> {
    let path = dir.join(LICENSE_FILE);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(LicenseError::Io {
            source: e,
            path: path.clone(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- write_license_key / read_license_key ---

    #[test]
    fn license_key_write_read_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let pem = "-----BEGIN LICENSE KEY-----\ndata.sig\n-----END LICENSE KEY-----";
        write_license_key(dir.path(), pem).unwrap();
        let read = read_license_key(dir.path()).unwrap().unwrap();
        assert_eq!(read, pem);
    }

    #[test]
    fn license_key_missing_file_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_license_key(dir.path()).unwrap().is_none());
    }

    #[test]
    fn license_key_auto_creates_parent_dir() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("deep").join("nested");
        write_license_key(&nested, "key data").unwrap();
        assert!(read_license_key(&nested).unwrap().is_some());
    }

    // --- remove_license_key ---

    #[test]
    fn remove_existing_license_key() {
        let dir = tempfile::tempdir().unwrap();
        write_license_key(dir.path(), "data").unwrap();
        remove_license_key(dir.path()).unwrap();
        assert!(read_license_key(dir.path()).unwrap().is_none());
    }

    #[test]
    fn remove_nonexistent_license_key_ok() {
        let dir = tempfile::tempdir().unwrap();
        assert!(remove_license_key(dir.path()).is_ok());
    }

    // --- revocation marker ---

    #[test]
    fn revocation_marker_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        write_revocation_marker(dir.path(), Some("refund")).unwrap();
        let marker = read_revocation_marker(dir.path()).unwrap();
        assert_eq!(marker.reason, Some("refund".to_string()));
    }

    #[test]
    fn revocation_marker_none_reason_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        write_revocation_marker(dir.path(), None).unwrap();
        let marker = read_revocation_marker(dir.path()).unwrap();
        assert_eq!(marker.reason, None);
    }

    #[test]
    fn revocation_marker_missing_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_revocation_marker(dir.path()).is_none());
    }

    #[test]
    fn revocation_marker_corrupt_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(REVOCATION_FILE), "not json").unwrap();
        assert!(read_revocation_marker(dir.path()).is_none());
    }

    #[test]
    fn revocation_marker_auto_creates_parent_dir() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("deep").join("nested");
        write_revocation_marker(&nested, Some("refund")).unwrap();
        assert!(read_revocation_marker(&nested).is_some());
    }

    #[test]
    fn clear_revocation_marker_removes_it() {
        let dir = tempfile::tempdir().unwrap();
        write_revocation_marker(dir.path(), Some("refund")).unwrap();
        clear_revocation_marker(dir.path()).unwrap();
        assert!(read_revocation_marker(dir.path()).is_none());
    }

    #[test]
    fn clear_revocation_marker_missing_ok() {
        let dir = tempfile::tempdir().unwrap();
        assert!(clear_revocation_marker(dir.path()).is_ok());
    }
}
