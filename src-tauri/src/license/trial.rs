use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

use super::error::LicenseError;

pub const TRIAL_DURATION_SECS: u64 = 14 * 86400;
pub const EXPIRING_SOON_THRESHOLD_SECS: u64 = 3 * 86400;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrialState {
    Active { days_left: u64 },
    ExpiringSoon { days_left: u64 },
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrialData {
    pub trial_start_ts: u64,
    #[serde(with = "base64_bytes")]
    pub signature: Vec<u8>,
}

mod base64_bytes {
    use base64::Engine;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &Vec<u8>, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&base64::engine::general_purpose::STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        base64::engine::general_purpose::STANDARD
            .decode(s)
            .map_err(serde::de::Error::custom)
    }
}

pub fn compute_trial_state(start_ts: u64, now: u64, duration_secs: u64) -> TrialState {
    let elapsed = now.saturating_sub(start_ts);
    if elapsed >= duration_secs {
        return TrialState::Expired;
    }
    let remaining = duration_secs - elapsed;
    let days_left = remaining.div_ceil(86400);
    if remaining <= EXPIRING_SOON_THRESHOLD_SECS {
        TrialState::ExpiringSoon { days_left }
    } else {
        TrialState::Active { days_left }
    }
}

pub fn sign_trial_start(ts: u64, signing_key: &SigningKey) -> Vec<u8> {
    signing_key.sign(&ts.to_le_bytes()).to_bytes().to_vec()
}

pub fn verify_trial_signature(
    ts: u64,
    signature: &[u8],
    verifying_key: &VerifyingKey,
) -> Result<(), LicenseError> {
    let sig = ed25519_dalek::Signature::from_slice(signature)
        .map_err(|_| LicenseError::InvalidSignature)?;
    verifying_key
        .verify(&ts.to_le_bytes(), &sig)
        .map_err(|_| LicenseError::InvalidSignature)
}

pub fn create_trial_data(signing_key: &SigningKey) -> TrialData {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let signature = sign_trial_start(now, signing_key);
    TrialData {
        trial_start_ts: now,
        signature,
    }
}

pub fn evaluate_trial(
    data: &TrialData,
    verifying_key: &VerifyingKey,
    now: u64,
    duration_secs: u64,
) -> TrialState {
    if verify_trial_signature(data.trial_start_ts, &data.signature, verifying_key).is_err() {
        return TrialState::Expired;
    }
    compute_trial_state(data.trial_start_ts, now, duration_secs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;

    fn test_keys() -> (SigningKey, VerifyingKey) {
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        (sk, vk)
    }

    // --- compute_trial_state ---

    #[test]
    fn active_day_1() {
        let start = 1000;
        let now = start + 86400;
        assert_eq!(
            compute_trial_state(start, now, TRIAL_DURATION_SECS),
            TrialState::Active { days_left: 13 }
        );
    }

    #[test]
    fn active_day_10() {
        let start = 1000;
        let now = start + 10 * 86400;
        assert_eq!(
            compute_trial_state(start, now, TRIAL_DURATION_SECS),
            TrialState::Active { days_left: 4 }
        );
    }

    #[test]
    fn expiring_soon_exactly_3_days() {
        let start = 0;
        let now = TRIAL_DURATION_SECS - EXPIRING_SOON_THRESHOLD_SECS;
        assert_eq!(
            compute_trial_state(start, now, TRIAL_DURATION_SECS),
            TrialState::ExpiringSoon { days_left: 3 }
        );
    }

    #[test]
    fn expiring_soon_2_days() {
        let start = 0;
        let now = TRIAL_DURATION_SECS - 2 * 86400;
        assert_eq!(
            compute_trial_state(start, now, TRIAL_DURATION_SECS),
            TrialState::ExpiringSoon { days_left: 2 }
        );
    }

    #[test]
    fn expiring_soon_1_day() {
        let start = 0;
        let now = TRIAL_DURATION_SECS - 86400;
        assert_eq!(
            compute_trial_state(start, now, TRIAL_DURATION_SECS),
            TrialState::ExpiringSoon { days_left: 1 }
        );
    }

    #[test]
    fn expired_at_duration() {
        let start = 0;
        let now = TRIAL_DURATION_SECS;
        assert_eq!(
            compute_trial_state(start, now, TRIAL_DURATION_SECS),
            TrialState::Expired
        );
    }

    #[test]
    fn expired_past_duration() {
        let start = 0;
        let now = TRIAL_DURATION_SECS + 86400;
        assert_eq!(
            compute_trial_state(start, now, TRIAL_DURATION_SECS),
            TrialState::Expired
        );
    }

    #[test]
    fn same_second_edge_case() {
        let start = 5000;
        assert_eq!(
            compute_trial_state(start, start, TRIAL_DURATION_SECS),
            TrialState::Active { days_left: 14 }
        );
    }

    #[test]
    fn partial_day_rounds_up() {
        // 1 second into a 14-day trial: 13 days + 86399 seconds remain → 14 days
        let start = 0;
        let now = 1;
        assert_eq!(
            compute_trial_state(start, now, TRIAL_DURATION_SECS),
            TrialState::Active { days_left: 14 },
        );
    }

    #[test]
    fn partial_day_half_day_remaining() {
        // 12 hours left → 1 day, not 0
        let start = 0;
        let now = TRIAL_DURATION_SECS - 43200;
        assert_eq!(
            compute_trial_state(start, now, TRIAL_DURATION_SECS),
            TrialState::ExpiringSoon { days_left: 1 },
        );
    }

    // --- sign_trial_start ---

    #[test]
    fn sign_produces_64_bytes() {
        let (sk, _) = test_keys();
        let sig = sign_trial_start(12345, &sk);
        assert_eq!(sig.len(), 64);
    }

    #[test]
    fn sign_deterministic() {
        let (sk, _) = test_keys();
        let a = sign_trial_start(12345, &sk);
        let b = sign_trial_start(12345, &sk);
        assert_eq!(a, b);
    }

    #[test]
    fn sign_different_ts_different_sig() {
        let (sk, _) = test_keys();
        let a = sign_trial_start(100, &sk);
        let b = sign_trial_start(200, &sk);
        assert_ne!(a, b);
    }

    // --- verify_trial_signature ---

    #[test]
    fn verify_valid_signature() {
        let (sk, vk) = test_keys();
        let sig = sign_trial_start(42, &sk);
        assert!(verify_trial_signature(42, &sig, &vk).is_ok());
    }

    #[test]
    fn verify_tampered_ts_fails() {
        let (sk, vk) = test_keys();
        let sig = sign_trial_start(42, &sk);
        assert!(verify_trial_signature(43, &sig, &vk).is_err());
    }

    #[test]
    fn verify_tampered_sig_fails() {
        let (sk, vk) = test_keys();
        let mut sig = sign_trial_start(42, &sk);
        sig[0] ^= 0xff;
        assert!(verify_trial_signature(42, &sig, &vk).is_err());
    }

    #[test]
    fn verify_wrong_key_fails() {
        let (sk, _) = test_keys();
        let (_, vk2) = test_keys();
        let sig = sign_trial_start(42, &sk);
        assert!(verify_trial_signature(42, &sig, &vk2).is_err());
    }

    #[test]
    fn verify_empty_sig_fails() {
        let (_, vk) = test_keys();
        assert!(verify_trial_signature(42, &[], &vk).is_err());
    }

    #[test]
    fn verify_short_sig_fails() {
        let (_, vk) = test_keys();
        assert!(verify_trial_signature(42, &[0u8; 10], &vk).is_err());
    }

    // --- create_trial_data ---

    #[test]
    fn create_trial_data_recent_timestamp() {
        let (sk, _) = test_keys();
        let data = create_trial_data(&sk);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        assert!(now - data.trial_start_ts <= 2);
    }

    #[test]
    fn create_trial_data_verifies_round_trip() {
        let (sk, vk) = test_keys();
        let data = create_trial_data(&sk);
        assert!(verify_trial_signature(data.trial_start_ts, &data.signature, &vk).is_ok());
    }

    // --- evaluate_trial ---

    #[test]
    fn evaluate_valid_active() {
        let (sk, vk) = test_keys();
        let data = create_trial_data(&sk);
        let now = data.trial_start_ts + 86400;
        assert_eq!(
            evaluate_trial(&data, &vk, now, TRIAL_DURATION_SECS),
            TrialState::Active { days_left: 13 }
        );
    }

    #[test]
    fn evaluate_valid_expired() {
        let (sk, vk) = test_keys();
        let data = create_trial_data(&sk);
        let now = data.trial_start_ts + TRIAL_DURATION_SECS;
        assert_eq!(
            evaluate_trial(&data, &vk, now, TRIAL_DURATION_SECS),
            TrialState::Expired
        );
    }

    #[test]
    fn evaluate_valid_expiring_soon() {
        let (sk, vk) = test_keys();
        let data = create_trial_data(&sk);
        let now = data.trial_start_ts + TRIAL_DURATION_SECS - 2 * 86400;
        assert_eq!(
            evaluate_trial(&data, &vk, now, TRIAL_DURATION_SECS),
            TrialState::ExpiringSoon { days_left: 2 }
        );
    }

    #[test]
    fn evaluate_tampered_sig_returns_expired() {
        let (sk, vk) = test_keys();
        let mut data = create_trial_data(&sk);
        data.signature[0] ^= 0xff;
        let now = data.trial_start_ts + 100;
        assert_eq!(
            evaluate_trial(&data, &vk, now, TRIAL_DURATION_SECS),
            TrialState::Expired
        );
    }
}
