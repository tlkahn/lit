pub mod error;
pub mod key;
pub mod keygen;
pub mod online;
#[cfg(feature = "app-store")]
pub mod receipt;
pub mod storage;

use ed25519_dalek::VerifyingKey;
use serde::Serialize;
use std::path::Path;

use error::LicenseError;
use key::LicensePayload;

#[cfg(debug_assertions)]
pub const LICENSE_VERIFYING_KEY_BYTES: &[u8; 32] =
    include_bytes!("../../keys/dev_license_verifying.bin");

#[cfg(not(debug_assertions))]
pub const LICENSE_VERIFYING_KEY_BYTES: &[u8; 32] =
    include_bytes!(concat!(env!("OUT_DIR"), "/prod_license_verifying.bin"));

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum LicenseStatus {
    Unlicensed,
    Licensed(LicensePayload),
    LicenseExpired {
        payload: LicensePayload,
        expired_at: u64,
    },
    /// The server revoked this license. The key file has been deleted, but a
    /// local marker records the reason so the UI can explain the revocation
    /// instead of falling back to the generic `Unlicensed` splash.
    Revoked {
        reason: Option<String>,
    },
}

/// Classify a verified payload as `Licensed` or `LicenseExpired` at `now`.
///
/// Expiry is inclusive (`now >= expires_at`); perpetual licenses
/// (`expires_at: None`) are always `Licensed`. When expired, the original
/// `expires_at` value is carried through as `expired_at`.
fn check_expiry(payload: LicensePayload, now: u64) -> LicenseStatus {
    if let Some(exp) = payload.expires_at {
        if payload.is_expired(now) {
            return LicenseStatus::LicenseExpired {
                payload,
                expired_at: exp,
            };
        }
    }
    LicenseStatus::Licensed(payload)
}

pub fn get_status(
    dir: &Path,
    license_verifying_key: &VerifyingKey,
    now: u64,
) -> LicenseStatus {
    #[cfg(feature = "app-store")]
    {
        if let Some(payload) = receipt::validate_app_store_receipt() {
            return check_expiry(payload, now);
        }
    }
    if let Ok(Some(pem)) = storage::read_license_key(dir) {
        if let Ok(payload) = key::verify_license_key(&pem, license_verifying_key) {
            // A valid local key wins over any stale revocation marker, so a
            // freshly re-activated license is never blocked by an old marker.
            return check_expiry(payload, now);
        }
    }
    // No valid key. If the server revoked the license (key already deleted),
    // surface a revocation-specific state rather than the generic Unlicensed.
    if let Some(marker) = storage::read_revocation_marker(dir) {
        return LicenseStatus::Revoked {
            reason: marker.reason,
        };
    }
    LicenseStatus::Unlicensed
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DevOverride {
    Unlicensed,
    Licensed,
    LicenseExpired,
    Revoked,
}

#[cfg(debug_assertions)]
pub fn dev_mode_override() -> Option<DevOverride> {
    match std::env::var("LIT_LICENSE_DEV").ok()?.as_str() {
        "unlicensed" => Some(DevOverride::Unlicensed),
        "licensed" => Some(DevOverride::Licensed),
        "license_expired" => Some(DevOverride::LicenseExpired),
        "revoked" => Some(DevOverride::Revoked),
        _ => None,
    }
}

#[cfg(not(debug_assertions))]
pub fn dev_mode_override() -> Option<DevOverride> {
    None
}

pub fn activate_key(
    dir: &Path,
    pem: &str,
    vk: &VerifyingKey,
    now: u64,
) -> Result<LicenseStatus, LicenseError> {
    let payload = key::verify_license_key(pem, vk)?;
    storage::write_license_key(dir, pem)?;
    let _ = storage::clear_revocation_marker(dir);
    Ok(check_expiry(payload, now))
}

pub fn process_deep_link_url(url: &str) -> Option<String> {
    match parse_activate_url(url) {
        Ok(key) => Some(key),
        Err(e) => {
            tracing::warn!("invalid deep-link URL {url:?}: {e}");
            None
        }
    }
}

pub fn parse_activate_url(url: &str) -> Result<String, LicenseError> {
    let url = url::Url::parse(url)
        .map_err(|e| LicenseError::InvalidKeyFormat(format!("invalid URL: {e}")))?;
    if url.scheme() != "lit" {
        return Err(LicenseError::InvalidKeyFormat(format!(
            "expected lit:// scheme, got {}://",
            url.scheme()
        )));
    }
    let key = url
        .query_pairs()
        .find(|(k, _)| k == "key")
        .map(|(_, v)| v.to_string())
        .ok_or_else(|| LicenseError::InvalidKeyFormat("missing 'key' parameter".into()))?;
    if key.is_empty() {
        return Err(LicenseError::InvalidKeyFormat("empty 'key' parameter".into()));
    }
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use rand::rngs::OsRng;

    fn test_keys() -> (SigningKey, VerifyingKey) {
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        (sk, vk)
    }

    fn build_test_pem(payload: &LicensePayload, signing_key: &SigningKey) -> String {
        use base64::Engine;
        let json = serde_json::to_string(payload).unwrap();
        let payload_b64 = base64::engine::general_purpose::STANDARD.encode(json.as_bytes());
        let sig = signing_key.sign(payload_b64.as_bytes());
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(sig.to_bytes());
        format!(
            "-----BEGIN LICENSE KEY-----\n{}.{}\n-----END LICENSE KEY-----",
            payload_b64, sig_b64
        )
    }

    fn sample_payload(expires_at: Option<u64>) -> LicensePayload {
        LicensePayload {
            license_id: "lic-1".into(),
            name: "User".into(),
            email: "u@example.com".into(),
            issued_at: 100,
            license_type: "personal".into(),
            expires_at,
            source: key::LicenseSource::Direct,
        }
    }

    // --- embedded keys ---

    #[test]
    fn embedded_license_key_is_32_bytes() {
        assert_eq!(LICENSE_VERIFYING_KEY_BYTES.len(), 32);
    }

    #[test]
    fn can_construct_verifying_key_from_embedded() {
        let _vk = VerifyingKey::from_bytes(LICENSE_VERIFYING_KEY_BYTES).unwrap();
    }

    // --- LicenseStatus serialization ---

    #[test]
    fn license_status_unlicensed_serializes() {
        let status = LicenseStatus::Unlicensed;
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"kind\":\"Unlicensed\""));
    }

    #[test]
    fn license_status_licensed_serializes() {
        let status = LicenseStatus::Licensed(sample_payload(None));
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"kind\":\"Licensed\""));
        assert!(json.contains("\"name\":\"User\""));
    }

    #[test]
    fn license_status_revoked_serializes() {
        let status = LicenseStatus::Revoked {
            reason: Some("refund".into()),
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"kind\":\"Revoked\""));
        assert!(json.contains("\"reason\":\"refund\""));
    }

    #[test]
    fn get_status_revoked_marker_returns_revoked() {
        let dir = tempfile::tempdir().unwrap();
        let (_, lic_vk) = test_keys();
        // No license key on disk, but a revocation marker is present.
        storage::write_revocation_marker(dir.path(), Some("refund")).unwrap();
        match get_status(dir.path(), &lic_vk, 200) {
            LicenseStatus::Revoked { reason } => assert_eq!(reason, Some("refund".into())),
            other => panic!("expected Revoked, got {:?}", other),
        }
    }

    #[test]
    fn get_status_valid_key_ignores_stale_marker() {
        let dir = tempfile::tempdir().unwrap();
        let lic_sk = SigningKey::generate(&mut OsRng);
        let lic_vk = lic_sk.verifying_key();
        let payload = sample_payload(None);
        let pem = build_test_pem(&payload, &lic_sk);
        storage::write_license_key(dir.path(), &pem).unwrap();
        // A stale marker is present, but a valid key wins (re-activation case).
        storage::write_revocation_marker(dir.path(), Some("refund")).unwrap();
        match get_status(dir.path(), &lic_vk, 200) {
            LicenseStatus::Licensed(p) => assert_eq!(p.license_id, "lic-1"),
            other => panic!("expected Licensed, got {:?}", other),
        }
    }

    #[test]
    fn license_status_license_expired_serializes() {
        let status = LicenseStatus::LicenseExpired {
            payload: sample_payload(Some(150)),
            expired_at: 150,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"kind\":\"LicenseExpired\""));
        assert!(json.contains("\"expired_at\":150"));
        assert!(json.contains("\"name\":\"User\""));
    }

    // --- get_status ---

    #[test]
    fn get_status_no_license_returns_unlicensed() {
        let dir = tempfile::tempdir().unwrap();
        let (_, lic_vk) = test_keys();
        match get_status(dir.path(), &lic_vk, 200) {
            LicenseStatus::Unlicensed => {}
            other => panic!("expected Unlicensed, got {:?}", other),
        }
    }

    #[test]
    fn get_status_invalid_license_returns_unlicensed() {
        let dir = tempfile::tempdir().unwrap();
        let (_, lic_vk) = test_keys();
        storage::write_license_key(dir.path(), "garbage").unwrap();
        match get_status(dir.path(), &lic_vk, 200) {
            LicenseStatus::Unlicensed => {}
            other => panic!("expected Unlicensed, got {:?}", other),
        }
    }

    #[test]
    fn get_status_valid_license_returns_licensed() {
        let dir = tempfile::tempdir().unwrap();
        let lic_sk = SigningKey::generate(&mut OsRng);
        let lic_vk = lic_sk.verifying_key();
        let payload = sample_payload(None);
        let pem = build_test_pem(&payload, &lic_sk);
        storage::write_license_key(dir.path(), &pem).unwrap();
        match get_status(dir.path(), &lic_vk, 200) {
            LicenseStatus::Licensed(p) => assert_eq!(p.license_id, "lic-1"),
            other => panic!("expected Licensed, got {:?}", other),
        }
    }

    #[test]
    fn get_status_perpetual_returns_licensed() {
        let dir = tempfile::tempdir().unwrap();
        let lic_sk = SigningKey::generate(&mut OsRng);
        let lic_vk = lic_sk.verifying_key();
        let payload = sample_payload(None);
        let pem = build_test_pem(&payload, &lic_sk);
        storage::write_license_key(dir.path(), &pem).unwrap();
        match get_status(dir.path(), &lic_vk, u64::MAX) {
            LicenseStatus::Licensed(_) => {}
            other => panic!("expected Licensed, got {:?}", other),
        }
    }

    #[test]
    fn get_status_unexpired_returns_licensed() {
        let dir = tempfile::tempdir().unwrap();
        let lic_sk = SigningKey::generate(&mut OsRng);
        let lic_vk = lic_sk.verifying_key();
        let payload = sample_payload(Some(1000));
        let pem = build_test_pem(&payload, &lic_sk);
        storage::write_license_key(dir.path(), &pem).unwrap();
        match get_status(dir.path(), &lic_vk, 999) {
            LicenseStatus::Licensed(_) => {}
            other => panic!("expected Licensed, got {:?}", other),
        }
    }

    #[test]
    fn get_status_expired_returns_license_expired() {
        let dir = tempfile::tempdir().unwrap();
        let lic_sk = SigningKey::generate(&mut OsRng);
        let lic_vk = lic_sk.verifying_key();
        let payload = sample_payload(Some(1000));
        let pem = build_test_pem(&payload, &lic_sk);
        storage::write_license_key(dir.path(), &pem).unwrap();
        match get_status(dir.path(), &lic_vk, 1000) {
            LicenseStatus::LicenseExpired { expired_at, payload } => {
                assert_eq!(expired_at, 1000);
                assert_eq!(payload.license_id, "lic-1");
            }
            other => panic!("expected LicenseExpired, got {:?}", other),
        }
    }

    #[test]
    fn get_status_early_adopter_license_returns_licensed() {
        let dir = tempfile::tempdir().unwrap();
        let lic_sk = SigningKey::generate(&mut OsRng);
        let lic_vk = lic_sk.verifying_key();
        let payload = LicensePayload {
            license_id: "lic-ea-001".into(),
            name: "Customer".into(),
            email: "early@example.com".into(),
            issued_at: 100,
            license_type: "early_adopter".into(),
            expires_at: None,
            source: key::LicenseSource::Direct,
        };
        let pem = build_test_pem(&payload, &lic_sk);
        storage::write_license_key(dir.path(), &pem).unwrap();
        match get_status(dir.path(), &lic_vk, 200) {
            LicenseStatus::Licensed(p) => {
                assert_eq!(p.license_id, "lic-ea-001");
                assert_eq!(p.license_type, "early_adopter");
            }
            other => panic!("expected Licensed, got {:?}", other),
        }
    }

    // --- check_expiry helper ---

    #[test]
    fn check_expiry_expired_returns_license_expired() {
        match check_expiry(sample_payload(Some(1000)), 1000) {
            LicenseStatus::LicenseExpired { expired_at, payload } => {
                assert_eq!(expired_at, 1000);
                assert_eq!(payload.license_id, "lic-1");
            }
            other => panic!("expected LicenseExpired, got {:?}", other),
        }
    }

    #[test]
    fn check_expiry_unexpired_returns_licensed() {
        match check_expiry(sample_payload(Some(1000)), 999) {
            LicenseStatus::Licensed(p) => assert_eq!(p.expires_at, Some(1000)),
            other => panic!("expected Licensed, got {:?}", other),
        }
    }

    #[test]
    fn check_expiry_perpetual_returns_licensed() {
        match check_expiry(sample_payload(None), u64::MAX) {
            LicenseStatus::Licensed(_) => {}
            other => panic!("expected Licensed, got {:?}", other),
        }
    }

    // --- app-store receipt wiring (stub) ---

    #[cfg(feature = "app-store")]
    #[test]
    fn get_status_app_store_stub_falls_through_to_local() {
        // The App Store receipt stub returns None, so get_status must fall
        // through to the existing local-key path and report Licensed.
        let dir = tempfile::tempdir().unwrap();
        let lic_sk = SigningKey::generate(&mut OsRng);
        let lic_vk = lic_sk.verifying_key();
        let payload = sample_payload(None);
        let pem = build_test_pem(&payload, &lic_sk);
        storage::write_license_key(dir.path(), &pem).unwrap();
        match get_status(dir.path(), &lic_vk, 200) {
            LicenseStatus::Licensed(p) => assert_eq!(p.license_id, "lic-1"),
            other => panic!("expected Licensed, got {:?}", other),
        }
    }

    #[cfg(feature = "app-store")]
    #[test]
    fn get_status_app_store_stub_no_local_returns_unlicensed() {
        // With no local key and the stub returning None, status is Unlicensed.
        let dir = tempfile::tempdir().unwrap();
        let (_, lic_vk) = test_keys();
        match get_status(dir.path(), &lic_vk, 200) {
            LicenseStatus::Unlicensed => {}
            other => panic!("expected Unlicensed, got {:?}", other),
        }
    }

    // --- activate_key ---

    #[test]
    fn activate_key_clears_revocation_marker() {
        let dir = tempfile::tempdir().unwrap();
        let (sk, vk) = test_keys();
        let payload = sample_payload(None);
        let pem = build_test_pem(&payload, &sk);
        storage::write_revocation_marker(dir.path(), Some("refund")).unwrap();
        let status = activate_key(dir.path(), &pem, &vk, 200).unwrap();
        assert!(matches!(status, LicenseStatus::Licensed(_)));
        assert!(storage::read_revocation_marker(dir.path()).is_none());
    }

    #[test]
    fn activate_key_invalid_key_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let (_, vk) = test_keys();
        assert!(activate_key(dir.path(), "garbage", &vk, 200).is_err());
    }

    #[test]
    fn activate_key_persists_license_key() {
        let dir = tempfile::tempdir().unwrap();
        let (sk, vk) = test_keys();
        let payload = sample_payload(None);
        let pem = build_test_pem(&payload, &sk);
        activate_key(dir.path(), &pem, &vk, 200).unwrap();
        let stored = storage::read_license_key(dir.path()).unwrap();
        assert_eq!(stored, Some(pem));
    }

    // --- dev_mode_override ---

    static ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn dev_override_unset_returns_none() {
        let _lock = ENV_MUTEX.lock().unwrap();
        std::env::remove_var("LIT_LICENSE_DEV");
        assert_eq!(dev_mode_override(), None);
    }

    #[test]
    fn dev_override_unlicensed() {
        let _lock = ENV_MUTEX.lock().unwrap();
        std::env::set_var("LIT_LICENSE_DEV", "unlicensed");
        assert_eq!(dev_mode_override(), Some(DevOverride::Unlicensed));
        std::env::remove_var("LIT_LICENSE_DEV");
    }

    #[test]
    fn dev_override_licensed() {
        let _lock = ENV_MUTEX.lock().unwrap();
        std::env::set_var("LIT_LICENSE_DEV", "licensed");
        assert_eq!(dev_mode_override(), Some(DevOverride::Licensed));
        std::env::remove_var("LIT_LICENSE_DEV");
    }

    #[test]
    fn dev_override_license_expired() {
        let _lock = ENV_MUTEX.lock().unwrap();
        std::env::set_var("LIT_LICENSE_DEV", "license_expired");
        assert_eq!(dev_mode_override(), Some(DevOverride::LicenseExpired));
        std::env::remove_var("LIT_LICENSE_DEV");
    }

    #[test]
    fn dev_override_revoked() {
        let _lock = ENV_MUTEX.lock().unwrap();
        std::env::set_var("LIT_LICENSE_DEV", "revoked");
        assert_eq!(dev_mode_override(), Some(DevOverride::Revoked));
        std::env::remove_var("LIT_LICENSE_DEV");
    }

    #[test]
    fn dev_override_unknown_returns_none() {
        let _lock = ENV_MUTEX.lock().unwrap();
        std::env::set_var("LIT_LICENSE_DEV", "garbage");
        assert_eq!(dev_mode_override(), None);
        std::env::remove_var("LIT_LICENSE_DEV");
    }

    // --- parse_activate_url ---

    #[test]
    fn process_deep_link_url_valid() {
        assert_eq!(process_deep_link_url("lit://activate?key=abc123"), Some("abc123".into()));
    }

    #[test]
    fn process_deep_link_url_invalid_returns_none() {
        assert_eq!(process_deep_link_url("http://bad?key=abc"), None);
    }

    #[test]
    fn parse_activate_url_valid() {
        let key = parse_activate_url("lit://activate?key=abc123").unwrap();
        assert_eq!(key, "abc123");
    }

    #[test]
    fn parse_activate_url_missing_key_param() {
        assert!(parse_activate_url("lit://activate?foo=bar").is_err());
    }

    #[test]
    fn parse_activate_url_url_encoded_key() {
        let key = parse_activate_url("lit://activate?key=abc%20def").unwrap();
        assert_eq!(key, "abc def");
    }

    #[test]
    fn parse_activate_url_wrong_scheme() {
        assert!(parse_activate_url("http://activate?key=abc").is_err());
    }

    #[test]
    fn parse_activate_url_empty_key() {
        assert!(parse_activate_url("lit://activate?key=").is_err());
    }

    // --- decode_key_b64 ---

    fn decode_key_b64(b64: &str) -> Result<[u8; 32], String> {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("invalid base64: {e}"))?;
        let arr: [u8; 32] = bytes
            .try_into()
            .map_err(|v: Vec<u8>| format!("expected 32 bytes, got {}", v.len()))?;
        Ok(arr)
    }

    #[test]
    fn decode_key_b64_valid_round_trip() {
        use base64::Engine;
        let key: [u8; 32] = [
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
            24, 25, 26, 27, 28, 29, 30, 31, 32,
        ];
        let b64 = base64::engine::general_purpose::STANDARD.encode(key);
        assert_eq!(decode_key_b64(&b64).unwrap(), key);
    }

    #[test]
    fn decode_key_b64_invalid_base64() {
        let err = decode_key_b64("not!valid!b64").unwrap_err();
        assert!(err.contains("invalid base64"), "got: {err}");
    }

    #[test]
    fn decode_key_b64_wrong_length() {
        use base64::Engine;
        let short: [u8; 16] = [0; 16];
        let b64 = base64::engine::general_purpose::STANDARD.encode(short);
        let err = decode_key_b64(&b64).unwrap_err();
        assert!(err.contains("32 bytes"), "got: {err}");
    }
}
