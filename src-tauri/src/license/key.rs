use base64::Engine;
use ed25519_dalek::{Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

use super::error::LicenseError;

const BEGIN_MARKER: &str = "-----BEGIN LICENSE KEY-----";
const END_MARKER: &str = "-----END LICENSE KEY-----";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LicenseSource {
    Direct,
    /// Catch-all for unrecognized/legacy source values (e.g. the removed
    /// `app_store` channel). Ensures previously-issued, validly-signed keys
    /// still deserialize instead of failing with an unknown-variant error.
    #[serde(other)]
    Other,
}

fn default_source() -> LicenseSource {
    LicenseSource::Direct
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LicensePayload {
    pub license_id: String,
    pub name: String,
    pub email: String,
    pub issued_at: u64,
    #[serde(rename = "type")]
    pub license_type: String,
    #[serde(default)]
    pub expires_at: Option<u64>,
    #[serde(default = "default_source")]
    pub source: LicenseSource,
}

impl LicensePayload {
    pub fn is_expired(&self, now: u64) -> bool {
        matches!(self.expires_at, Some(exp) if now >= exp)
    }
}

pub fn parse_pem(input: &str) -> Result<(String, String), LicenseError> {
    let trimmed = input.trim();
    if !trimmed.starts_with(BEGIN_MARKER) {
        return Err(LicenseError::InvalidKeyFormat("missing BEGIN marker".into()));
    }
    if !trimmed.ends_with(END_MARKER) {
        return Err(LicenseError::InvalidKeyFormat("missing END marker".into()));
    }
    let inner = &trimmed[BEGIN_MARKER.len()..trimmed.len() - END_MARKER.len()];
    let body: String = inner.lines().map(str::trim).collect();
    let (payload_b64, sig_b64) = body
        .split_once('.')
        .ok_or_else(|| LicenseError::InvalidKeyFormat("missing dot separator".into()))?;
    if payload_b64.is_empty() || sig_b64.is_empty() {
        return Err(LicenseError::InvalidKeyFormat("empty payload or signature".into()));
    }
    Ok((payload_b64.to_string(), sig_b64.to_string()))
}

pub fn decode_payload(base64_str: &str) -> Result<LicensePayload, LicenseError> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64_str)?;
    let payload: LicensePayload =
        serde_json::from_slice(&bytes).map_err(|e| LicenseError::InvalidKeyFormat(e.to_string()))?;
    Ok(payload)
}

pub fn verify_license_key(
    pem: &str,
    verifying_key: &VerifyingKey,
) -> Result<LicensePayload, LicenseError> {
    let (payload_b64, sig_b64) = parse_pem(pem)?;
    let sig_bytes = base64::engine::general_purpose::STANDARD.decode(&sig_b64)?;
    let sig = ed25519_dalek::Signature::from_slice(&sig_bytes)
        .map_err(|_| LicenseError::KeyVerificationFailed)?;
    verifying_key
        .verify(payload_b64.as_bytes(), &sig)
        .map_err(|_| LicenseError::KeyVerificationFailed)?;
    decode_payload(&payload_b64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use rand::rngs::OsRng;

    fn test_payload() -> LicensePayload {
        LicensePayload {
            license_id: "lic-001".into(),
            name: "Test User".into(),
            email: "test@example.com".into(),
            issued_at: 1700000000,
            license_type: "personal".into(),
            expires_at: None,
            source: LicenseSource::Direct,
        }
    }

    fn build_test_pem(payload: &LicensePayload, signing_key: &SigningKey) -> String {
        let json = serde_json::to_string(payload).unwrap();
        let payload_b64 = base64::engine::general_purpose::STANDARD.encode(json.as_bytes());
        let sig = signing_key.sign(payload_b64.as_bytes());
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(sig.to_bytes());
        format!(
            "{}\n{}.{}\n{}",
            BEGIN_MARKER, payload_b64, sig_b64, END_MARKER
        )
    }

    // --- parse_pem ---

    #[test]
    fn parse_pem_valid() {
        let pem = format!("{}\naGVsbG8.c2ln\n{}", BEGIN_MARKER, END_MARKER);
        let (p, s) = parse_pem(&pem).unwrap();
        assert_eq!(p, "aGVsbG8");
        assert_eq!(s, "c2ln");
    }

    #[test]
    fn parse_pem_missing_begin() {
        let pem = format!("aGVsbG8.c2ln\n{}", END_MARKER);
        assert!(parse_pem(&pem).is_err());
    }

    #[test]
    fn parse_pem_missing_end() {
        let pem = format!("{}\naGVsbG8.c2ln", BEGIN_MARKER);
        assert!(parse_pem(&pem).is_err());
    }

    #[test]
    fn parse_pem_no_dot() {
        let pem = format!("{}\naGVsbG8\n{}", BEGIN_MARKER, END_MARKER);
        assert!(parse_pem(&pem).is_err());
    }

    #[test]
    fn parse_pem_multiline() {
        let pem = format!(
            "{}\naGVs\nbG8.c2\nln\n{}",
            BEGIN_MARKER, END_MARKER
        );
        let (p, s) = parse_pem(&pem).unwrap();
        assert_eq!(p, "aGVsbG8");
        assert_eq!(s, "c2ln");
    }

    #[test]
    fn parse_pem_empty_body() {
        let pem = format!("{}\n.\n{}", BEGIN_MARKER, END_MARKER);
        assert!(parse_pem(&pem).is_err());
    }

    // --- decode_payload ---

    #[test]
    fn decode_payload_valid() {
        let payload = test_payload();
        let json = serde_json::to_string(&payload).unwrap();
        let b64 = base64::engine::general_purpose::STANDARD.encode(json.as_bytes());
        let decoded = decode_payload(&b64).unwrap();
        assert_eq!(decoded, payload);
    }

    #[test]
    fn decode_payload_invalid_base64() {
        assert!(decode_payload("not valid base64!!!").is_err());
    }

    #[test]
    fn decode_payload_invalid_json() {
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"not json");
        assert!(decode_payload(&b64).is_err());
    }

    #[test]
    fn decode_payload_missing_fields() {
        let json = r#"{"license_id":"x"}"#;
        let b64 = base64::engine::general_purpose::STANDARD.encode(json.as_bytes());
        assert!(decode_payload(&b64).is_err());
    }

    // --- verify_license_key ---

    #[test]
    fn verify_license_key_valid_round_trip() {
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        let payload = test_payload();
        let pem = build_test_pem(&payload, &sk);
        let result = verify_license_key(&pem, &vk).unwrap();
        assert_eq!(result, payload);
    }

    #[test]
    fn verify_license_key_tampered_payload() {
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        let payload = test_payload();
        let json = serde_json::to_string(&payload).unwrap();
        let payload_b64 = base64::engine::general_purpose::STANDARD.encode(json.as_bytes());
        let sig = sk.sign(payload_b64.as_bytes());
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(sig.to_bytes());
        // Tamper: use a different payload but keep the original signature
        let mut evil = payload.clone();
        evil.name = "Evil User".into();
        let evil_json = serde_json::to_string(&evil).unwrap();
        let evil_b64 = base64::engine::general_purpose::STANDARD.encode(evil_json.as_bytes());
        let pem = format!("{}\n{}.{}\n{}", BEGIN_MARKER, evil_b64, sig_b64, END_MARKER);
        assert!(verify_license_key(&pem, &vk).is_err());
    }

    #[test]
    fn verify_license_key_wrong_key() {
        let sk = SigningKey::generate(&mut OsRng);
        let sk2 = SigningKey::generate(&mut OsRng);
        let vk2 = sk2.verifying_key();
        let payload = test_payload();
        let pem = build_test_pem(&payload, &sk);
        assert!(verify_license_key(&pem, &vk2).is_err());
    }

    #[test]
    fn verify_license_key_invalid_sig_bytes() {
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        let payload = test_payload();
        let json = serde_json::to_string(&payload).unwrap();
        let payload_b64 = base64::engine::general_purpose::STANDARD.encode(json.as_bytes());
        let bad_sig = base64::engine::general_purpose::STANDARD.encode(b"short");
        let pem = format!("{}\n{}.{}\n{}", BEGIN_MARKER, payload_b64, bad_sig, END_MARKER);
        assert!(verify_license_key(&pem, &vk).is_err());
    }

    // --- serde round-trip ---

    #[test]
    fn license_payload_serde_round_trip() {
        let payload = test_payload();
        let json = serde_json::to_string(&payload).unwrap();
        let deserialized: LicensePayload = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, payload);
    }

    #[test]
    fn license_payload_type_field_renamed() {
        let payload = test_payload();
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains(r#""type":"personal""#));
        assert!(!json.contains("license_type"));
    }

    #[test]
    fn verify_license_key_early_adopter_type() {
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        let payload = LicensePayload {
            license_id: "lic-ea-001".into(),
            name: "Customer".into(),
            email: "early@example.com".into(),
            issued_at: 1700000000,
            license_type: "early_adopter".into(),
            expires_at: None,
            source: LicenseSource::Direct,
        };
        let pem = build_test_pem(&payload, &sk);
        let result = verify_license_key(&pem, &vk).unwrap();
        assert_eq!(result.license_type, "early_adopter");
    }

    // --- LicenseSource serde ---

    #[test]
    fn license_source_serializes_snake_case() {
        let direct = serde_json::to_string(&LicenseSource::Direct).unwrap();
        assert_eq!(direct, "\"direct\"");
    }

    // --- is_expired ---

    #[test]
    fn is_expired_returns_false_when_none() {
        let mut payload = test_payload();
        payload.expires_at = None;
        assert!(!payload.is_expired(u64::MAX));
    }

    #[test]
    fn is_expired_true_when_now_at_or_past_expires_at() {
        let mut payload = test_payload();
        payload.expires_at = Some(1000);
        assert!(payload.is_expired(1000));
        assert!(payload.is_expired(1001));
    }

    #[test]
    fn is_expired_false_when_now_before_expires_at() {
        let mut payload = test_payload();
        payload.expires_at = Some(1000);
        assert!(!payload.is_expired(999));
    }

    // --- backward compat: legacy JSON without expires_at/source ---

    #[test]
    fn decode_payload_backward_compat_defaults_none_and_direct() {
        let json = r#"{"license_id":"lic-1","name":"User","email":"u@example.com","issued_at":100,"type":"personal"}"#;
        let b64 = base64::engine::general_purpose::STANDARD.encode(json.as_bytes());
        let decoded = decode_payload(&b64).unwrap();
        assert_eq!(decoded.expires_at, None);
        assert_eq!(decoded.source, LicenseSource::Direct);
    }

    #[test]
    fn decode_payload_unknown_source_falls_back_to_other() {
        // Legacy keys minted before the app_store channel was removed carried
        // "source":"app_store". They must still deserialize, not error.
        let json = r#"{"license_id":"lic-as","name":"User","email":"u@example.com","issued_at":100,"type":"personal","source":"app_store"}"#;
        let b64 = base64::engine::general_purpose::STANDARD.encode(json.as_bytes());
        let decoded = decode_payload(&b64).unwrap();
        assert_eq!(decoded.source, LicenseSource::Other);
    }

    #[test]
    fn verify_license_key_legacy_app_store_source_still_valid() {
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        let json = r#"{"license_id":"lic-as","name":"User","email":"u@example.com","issued_at":100,"type":"personal","source":"app_store"}"#;
        let payload_b64 = base64::engine::general_purpose::STANDARD.encode(json.as_bytes());
        let sig = sk.sign(payload_b64.as_bytes());
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(sig.to_bytes());
        let pem = format!("{}\n{}.{}\n{}", BEGIN_MARKER, payload_b64, sig_b64, END_MARKER);
        let result = verify_license_key(&pem, &vk).unwrap();
        assert_eq!(result.source, LicenseSource::Other);
    }
}
