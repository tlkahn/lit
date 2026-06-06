use std::path::Path;

use super::error::LicenseError;

const LICENSE_FILE: &str = "license.key";

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
}
