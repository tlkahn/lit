use std::path::Path;

use super::error::LicenseError;
use super::trial::TrialData;

const TRIAL_FILE: &str = "trial.json";
const LICENSE_FILE: &str = "license.key";

pub fn write_trial(dir: &Path, data: &TrialData) -> Result<(), LicenseError> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(TRIAL_FILE);
    let json = serde_json::to_string_pretty(data)?;
    std::fs::write(&path, json).map_err(|e| LicenseError::Io {
        source: e,
        path: path.clone(),
    })
}

pub fn read_trial(dir: &Path) -> Result<Option<TrialData>, LicenseError> {
    let path = dir.join(TRIAL_FILE);
    match std::fs::read_to_string(&path) {
        Ok(contents) => {
            let data: TrialData = serde_json::from_str(&contents)?;
            Ok(Some(data))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
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
    use super::super::trial::{sign_trial_start, TrialData};
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;

    fn sample_trial_data() -> TrialData {
        let sk = SigningKey::generate(&mut OsRng);
        let ts = 1700000000u64;
        TrialData {
            trial_start_ts: ts,
            signature: sign_trial_start(ts, &sk),
        }
    }

    // --- write_trial / read_trial ---

    #[test]
    fn trial_write_read_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let data = sample_trial_data();
        write_trial(dir.path(), &data).unwrap();
        let read = read_trial(dir.path()).unwrap().unwrap();
        assert_eq!(read.trial_start_ts, data.trial_start_ts);
        assert_eq!(read.signature, data.signature);
    }

    #[test]
    fn trial_missing_file_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_trial(dir.path()).unwrap().is_none());
    }

    #[test]
    fn trial_corrupt_json_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("trial.json"), "not json").unwrap();
        assert!(read_trial(dir.path()).is_err());
    }

    #[test]
    fn trial_auto_creates_parent_dir() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("deep").join("nested");
        let data = sample_trial_data();
        write_trial(&nested, &data).unwrap();
        assert!(read_trial(&nested).unwrap().is_some());
    }

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
