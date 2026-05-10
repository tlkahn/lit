pub mod error;
pub mod key;
pub mod keygen;
pub mod online;
pub mod storage;
pub mod trial;

use ed25519_dalek::{SigningKey, VerifyingKey};
use serde::Serialize;
use std::path::Path;

use error::LicenseError;
use key::LicensePayload;
use trial::TrialState;

#[cfg(debug_assertions)]
pub const TRIAL_SIGNING_KEY_BYTES: &[u8; 32] =
    include_bytes!("../../keys/dev_trial_signing.bin");

#[cfg(debug_assertions)]
pub const LICENSE_VERIFYING_KEY_BYTES: &[u8; 32] =
    include_bytes!("../../keys/dev_license_verifying.bin");

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum LicenseStatus {
    Trial(TrialState),
    Licensed(LicensePayload),
    Expired,
}

pub fn get_status(
    dir: &Path,
    trial_signing_key: &SigningKey,
    license_verifying_key: &VerifyingKey,
    now: u64,
) -> LicenseStatus {
    if let Ok(Some(pem)) = storage::read_license_key(dir) {
        if let Ok(payload) = key::verify_license_key(&pem, license_verifying_key) {
            return LicenseStatus::Licensed(payload);
        }
    }

    match storage::read_trial(dir) {
        Ok(Some(data)) => {
            let state = trial::evaluate_trial(
                &data,
                &trial_signing_key.verifying_key(),
                now,
                trial::TRIAL_DURATION_SECS,
            );
            match state {
                TrialState::Expired => LicenseStatus::Expired,
                other => LicenseStatus::Trial(other),
            }
        }
        Ok(None) => {
            let data = trial::create_trial_data(trial_signing_key);
            let _ = storage::write_trial(dir, &data);
            let state = trial::evaluate_trial(
                &data,
                &trial_signing_key.verifying_key(),
                now,
                trial::TRIAL_DURATION_SECS,
            );
            LicenseStatus::Trial(state)
        }
        Err(_) => LicenseStatus::Expired,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DevOverride {
    TrialShort,
    TrialExpired,
    Licensed,
}

#[cfg(debug_assertions)]
pub fn dev_mode_override() -> Option<DevOverride> {
    match std::env::var("LIT_LICENSE_DEV").ok()?.as_str() {
        "trial_short" => Some(DevOverride::TrialShort),
        "trial_expired" => Some(DevOverride::TrialExpired),
        "licensed" => Some(DevOverride::Licensed),
        _ => None,
    }
}

#[cfg(not(debug_assertions))]
pub fn dev_mode_override() -> Option<DevOverride> {
    None
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

    // --- embedded keys ---

    #[test]
    fn embedded_trial_key_is_32_bytes() {
        assert_eq!(TRIAL_SIGNING_KEY_BYTES.len(), 32);
    }

    #[test]
    fn embedded_license_key_is_32_bytes() {
        assert_eq!(LICENSE_VERIFYING_KEY_BYTES.len(), 32);
    }

    #[test]
    fn can_construct_signing_key_from_embedded() {
        let _sk = SigningKey::from_bytes(TRIAL_SIGNING_KEY_BYTES);
    }

    #[test]
    fn can_construct_verifying_key_from_embedded() {
        let _vk = VerifyingKey::from_bytes(LICENSE_VERIFYING_KEY_BYTES).unwrap();
    }

    // --- LicenseStatus serialization ---

    #[test]
    fn license_status_trial_serializes() {
        let status = LicenseStatus::Trial(TrialState::Active { days_left: 10 });
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"kind\":\"Trial\""));
        assert!(json.contains("\"days_left\":10"));
    }

    #[test]
    fn license_status_licensed_serializes() {
        let payload = LicensePayload {
            license_id: "lic-1".into(),
            name: "User".into(),
            email: "u@example.com".into(),
            issued_at: 100,
            license_type: "personal".into(),
        };
        let status = LicenseStatus::Licensed(payload);
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"kind\":\"Licensed\""));
        assert!(json.contains("\"name\":\"User\""));
    }

    #[test]
    fn license_status_expired_serializes() {
        let status = LicenseStatus::Expired;
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"kind\":\"Expired\""));
    }

    // --- get_status ---

    #[test]
    fn get_status_valid_license_returns_licensed() {
        let dir = tempfile::tempdir().unwrap();
        let (trial_sk, _) = test_keys();
        let lic_sk = SigningKey::generate(&mut OsRng);
        let lic_vk = lic_sk.verifying_key();
        let payload = LicensePayload {
            license_id: "lic-1".into(),
            name: "User".into(),
            email: "u@example.com".into(),
            issued_at: 100,
            license_type: "personal".into(),
        };
        let pem = build_test_pem(&payload, &lic_sk);
        storage::write_license_key(dir.path(), &pem).unwrap();
        let now = 200;
        match get_status(dir.path(), &trial_sk, &lic_vk, now) {
            LicenseStatus::Licensed(p) => assert_eq!(p.license_id, "lic-1"),
            other => panic!("expected Licensed, got {:?}", other),
        }
    }

    #[test]
    fn get_status_invalid_license_falls_through_to_trial() {
        let dir = tempfile::tempdir().unwrap();
        let (trial_sk, _) = test_keys();
        let lic_sk = SigningKey::generate(&mut OsRng);
        let lic_vk = lic_sk.verifying_key();
        // Write an invalid license key
        storage::write_license_key(dir.path(), "garbage").unwrap();
        // Write a valid trial
        let data = trial::create_trial_data(&trial_sk);
        storage::write_trial(dir.path(), &data).unwrap();
        let now = data.trial_start_ts + 86400;
        match get_status(dir.path(), &trial_sk, &lic_vk, now) {
            LicenseStatus::Trial(TrialState::Active { .. }) => {}
            other => panic!("expected Trial(Active), got {:?}", other),
        }
    }

    #[test]
    fn get_status_active_trial() {
        let dir = tempfile::tempdir().unwrap();
        let (trial_sk, _) = test_keys();
        let (_, lic_vk) = test_keys();
        let data = trial::create_trial_data(&trial_sk);
        storage::write_trial(dir.path(), &data).unwrap();
        let now = data.trial_start_ts + 86400;
        match get_status(dir.path(), &trial_sk, &lic_vk, now) {
            LicenseStatus::Trial(TrialState::Active { .. }) => {}
            other => panic!("expected Trial(Active), got {:?}", other),
        }
    }

    #[test]
    fn get_status_expired_trial() {
        let dir = tempfile::tempdir().unwrap();
        let (trial_sk, _) = test_keys();
        let (_, lic_vk) = test_keys();
        let data = trial::create_trial_data(&trial_sk);
        storage::write_trial(dir.path(), &data).unwrap();
        let now = data.trial_start_ts + trial::TRIAL_DURATION_SECS + 1;
        match get_status(dir.path(), &trial_sk, &lic_vk, now) {
            LicenseStatus::Expired => {}
            other => panic!("expected Expired, got {:?}", other),
        }
    }

    #[test]
    fn get_status_no_trial_creates_one() {
        let dir = tempfile::tempdir().unwrap();
        let (trial_sk, _) = test_keys();
        let (_, lic_vk) = test_keys();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        match get_status(dir.path(), &trial_sk, &lic_vk, now) {
            LicenseStatus::Trial(TrialState::Active { .. }) => {}
            other => panic!("expected Trial(Active), got {:?}", other),
        }
        assert!(storage::read_trial(dir.path()).unwrap().is_some());
    }

    #[test]
    fn get_status_tampered_trial_returns_expired() {
        let dir = tempfile::tempdir().unwrap();
        let (trial_sk, _) = test_keys();
        let (_, lic_vk) = test_keys();
        let mut data = trial::create_trial_data(&trial_sk);
        data.signature[0] ^= 0xff;
        storage::write_trial(dir.path(), &data).unwrap();
        let now = data.trial_start_ts + 100;
        match get_status(dir.path(), &trial_sk, &lic_vk, now) {
            LicenseStatus::Expired => {}
            other => panic!("expected Expired, got {:?}", other),
        }
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
    fn dev_override_trial_short() {
        let _lock = ENV_MUTEX.lock().unwrap();
        std::env::set_var("LIT_LICENSE_DEV", "trial_short");
        assert_eq!(dev_mode_override(), Some(DevOverride::TrialShort));
        std::env::remove_var("LIT_LICENSE_DEV");
    }

    #[test]
    fn dev_override_trial_expired() {
        let _lock = ENV_MUTEX.lock().unwrap();
        std::env::set_var("LIT_LICENSE_DEV", "trial_expired");
        assert_eq!(dev_mode_override(), Some(DevOverride::TrialExpired));
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
    fn dev_override_unknown_returns_none() {
        let _lock = ENV_MUTEX.lock().unwrap();
        std::env::set_var("LIT_LICENSE_DEV", "garbage");
        assert_eq!(dev_mode_override(), None);
        std::env::remove_var("LIT_LICENSE_DEV");
    }

    #[test]
    fn get_status_early_adopter_license_returns_licensed() {
        let dir = tempfile::tempdir().unwrap();
        let (trial_sk, _) = test_keys();
        let lic_sk = SigningKey::generate(&mut OsRng);
        let lic_vk = lic_sk.verifying_key();
        let payload = LicensePayload {
            license_id: "lic-ea-001".into(),
            name: "Customer".into(),
            email: "early@example.com".into(),
            issued_at: 100,
            license_type: "early_adopter".into(),
        };
        let pem = build_test_pem(&payload, &lic_sk);
        storage::write_license_key(dir.path(), &pem).unwrap();
        let now = 200;
        match get_status(dir.path(), &trial_sk, &lic_vk, now) {
            LicenseStatus::Licensed(p) => {
                assert_eq!(p.license_id, "lic-ea-001");
                assert_eq!(p.license_type, "early_adopter");
            }
            other => panic!("expected Licensed, got {:?}", other),
        }
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
}
