use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum LicenseError {
    #[error("invalid signature")]
    InvalidSignature,

    #[error("trial has expired")]
    ExpiredTrial,

    #[error("invalid key format: {0}")]
    InvalidKeyFormat(String),

    #[error("license key verification failed")]
    KeyVerificationFailed,

    #[error("network error: {0}")]
    Network(String),

    #[error("storage error: {0}")]
    Storage(String),

    #[error("I/O error at {path}: {source}")]
    Io {
        source: std::io::Error,
        path: PathBuf,
    },
}

impl From<std::io::Error> for LicenseError {
    fn from(e: std::io::Error) -> Self {
        LicenseError::Storage(e.to_string())
    }
}

impl From<serde_json::Error> for LicenseError {
    fn from(e: serde_json::Error) -> Self {
        LicenseError::Storage(e.to_string())
    }
}

impl From<base64::DecodeError> for LicenseError {
    fn from(e: base64::DecodeError) -> Self {
        LicenseError::InvalidKeyFormat(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_signature_display() {
        let err = LicenseError::InvalidSignature;
        assert_eq!(err.to_string(), "invalid signature");
    }

    #[test]
    fn expired_trial_display() {
        let err = LicenseError::ExpiredTrial;
        assert_eq!(err.to_string(), "trial has expired");
    }

    #[test]
    fn invalid_key_format_display() {
        let err = LicenseError::InvalidKeyFormat("bad base64".into());
        assert_eq!(err.to_string(), "invalid key format: bad base64");
    }

    #[test]
    fn key_verification_failed_display() {
        let err = LicenseError::KeyVerificationFailed;
        assert_eq!(err.to_string(), "license key verification failed");
    }

    #[test]
    fn network_display() {
        let err = LicenseError::Network("timeout".into());
        assert_eq!(err.to_string(), "network error: timeout");
    }

    #[test]
    fn storage_display() {
        let err = LicenseError::Storage("disk full".into());
        assert_eq!(err.to_string(), "storage error: disk full");
    }

    #[test]
    fn io_error_display() {
        let err = LicenseError::Io {
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "gone"),
            path: PathBuf::from("/some/file"),
        };
        let msg = err.to_string();
        assert!(msg.contains("/some/file"));
        assert!(msg.contains("gone"));
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
        let err: LicenseError = io_err.into();
        match &err {
            LicenseError::Storage(msg) => assert!(msg.contains("denied")),
            _ => panic!("expected Storage variant"),
        }
    }

    #[test]
    fn from_serde_json_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("not json").unwrap_err();
        let err: LicenseError = json_err.into();
        match &err {
            LicenseError::Storage(msg) => assert!(!msg.is_empty()),
            _ => panic!("expected Storage variant"),
        }
    }

    #[test]
    fn from_base64_decode_error() {
        use base64::Engine;
        let b64_err = base64::engine::general_purpose::STANDARD
            .decode("not valid base64!!!")
            .unwrap_err();
        let err: LicenseError = b64_err.into();
        match &err {
            LicenseError::InvalidKeyFormat(msg) => assert!(!msg.is_empty()),
            _ => panic!("expected InvalidKeyFormat variant"),
        }
    }
}
