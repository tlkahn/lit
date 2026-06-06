use base64::Engine;
use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::path::Path;

const BEGIN_MARKER: &str = "-----BEGIN LICENSE KEY-----";
const END_MARKER: &str = "-----END LICENSE KEY-----";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LicenseSource {
    Direct,
    AppStore,
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

pub fn sign_license_pem(payload: &LicensePayload, signing_key: &SigningKey) -> String {
    let json = serde_json::to_string(payload).expect("LicensePayload serializes to JSON");
    let payload_b64 = base64::engine::general_purpose::STANDARD.encode(json.as_bytes());
    let sig = signing_key.sign(payload_b64.as_bytes());
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(sig.to_bytes());
    format!("{BEGIN_MARKER}\n{payload_b64}.{sig_b64}\n{END_MARKER}")
}

pub fn verify_license_key(
    pem: &str,
    verifying_key: &VerifyingKey,
) -> Result<LicensePayload, String> {
    let trimmed = pem.trim();
    if !trimmed.starts_with(BEGIN_MARKER) {
        return Err("missing BEGIN marker".into());
    }
    if !trimmed.ends_with(END_MARKER) {
        return Err("missing END marker".into());
    }
    let inner = &trimmed[BEGIN_MARKER.len()..trimmed.len() - END_MARKER.len()];
    let body: String = inner.lines().map(str::trim).collect();
    let (payload_b64, sig_b64) = body
        .split_once('.')
        .ok_or("missing dot separator")?;
    if payload_b64.is_empty() || sig_b64.is_empty() {
        return Err("empty payload or signature".into());
    }
    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(sig_b64)
        .map_err(|e| format!("bad signature base64: {e}"))?;
    let sig = ed25519_dalek::Signature::from_slice(&sig_bytes)
        .map_err(|_| "invalid signature length")?;
    verifying_key
        .verify(payload_b64.as_bytes(), &sig)
        .map_err(|_| "signature verification failed")?;
    let payload_bytes = base64::engine::general_purpose::STANDARD
        .decode(payload_b64)
        .map_err(|e| format!("bad payload base64: {e}"))?;
    let payload: LicensePayload =
        serde_json::from_slice(&payload_bytes).map_err(|e| format!("bad payload JSON: {e}"))?;
    Ok(payload)
}

pub fn parse_duration(s: &str) -> Result<u64, String> {
    if s.len() < 2 {
        return Err(format!("invalid duration: {s:?}"));
    }
    let (num_str, suffix) = s.split_at(s.len() - 1);
    let n: u64 = num_str
        .parse()
        .map_err(|_| format!("invalid duration number: {num_str:?}"))?;
    match suffix {
        "d" => Ok(n * 86400),
        "h" => Ok(n * 3600),
        _ => Err(format!("unknown duration suffix: {suffix:?}")),
    }
}

pub fn parse_expires(input: Option<&str>, now: u64) -> Result<Option<u64>, String> {
    let s = match input {
        None => return Ok(None),
        Some(s) => s,
    };
    if let Ok(epoch) = s.parse::<u64>() {
        return Ok(Some(epoch));
    }
    let duration = parse_duration(s)?;
    Ok(Some(now + duration))
}

#[derive(Debug)]
pub struct KeygenArgs {
    pub name: String,
    pub email: String,
    pub expires: Option<String>,
    pub license_type: String,
    pub license_id: Option<String>,
    pub key_path: String,
}

impl Default for KeygenArgs {
    fn default() -> Self {
        let default_key = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../keys/dev_license_signing.bin")
            .to_string_lossy()
            .into_owned();
        Self {
            name: "Dev Tester".into(),
            email: "dev@lit.solar".into(),
            expires: None,
            license_type: "personal".into(),
            license_id: None,
            key_path: default_key,
        }
    }
}

pub fn parse_args(args: &[String]) -> Result<KeygenArgs, String> {
    let mut result = KeygenArgs::default();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--name" => {
                i += 1;
                result.name = args.get(i).ok_or("--name requires a value")?.clone();
            }
            "--email" => {
                i += 1;
                result.email = args.get(i).ok_or("--email requires a value")?.clone();
            }
            "--expires" => {
                i += 1;
                result.expires = Some(args.get(i).ok_or("--expires requires a value")?.clone());
            }
            "--type" => {
                i += 1;
                result.license_type = args.get(i).ok_or("--type requires a value")?.clone();
            }
            "--id" => {
                i += 1;
                result.license_id = Some(args.get(i).ok_or("--id requires a value")?.clone());
            }
            "--key" => {
                i += 1;
                result.key_path = args.get(i).ok_or("--key requires a value")?.clone();
            }
            other => return Err(format!("unknown flag: {other}")),
        }
        i += 1;
    }
    Ok(result)
}

pub fn load_signing_key(path: &Path) -> Result<SigningKey, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("cannot read key file {}: {e}", path.display()))?;
    let seed: [u8; 32] = bytes
        .try_into()
        .map_err(|v: Vec<u8>| format!("expected 32-byte key, got {} bytes", v.len()))?;
    Ok(SigningKey::from_bytes(&seed))
}

pub fn generate_key(args: &KeygenArgs, now: u64) -> Result<String, String> {
    let signing_key = load_signing_key(Path::new(&args.key_path))?;
    let expires_at = parse_expires(args.expires.as_deref(), now)?;
    let license_id = args
        .license_id
        .clone()
        .unwrap_or_else(|| format!("dev-{now}"));
    let payload = LicensePayload {
        license_id,
        name: args.name.clone(),
        email: args.email.clone(),
        issued_at: now,
        license_type: args.license_type.clone(),
        expires_at,
        source: LicenseSource::Direct,
    };
    Ok(sign_license_pem(&payload, &signing_key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;
    use std::io::Write;

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

    fn write_temp_key(key: &SigningKey) -> tempfile::NamedTempFile {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(&key.to_bytes()).unwrap();
        f.flush().unwrap();
        f
    }

    // --- Cycle 1: LicensePayload and serde ---

    #[test]
    fn payload_serde_round_trip() {
        let payload = test_payload();
        let json = serde_json::to_string(&payload).unwrap();
        let decoded: LicensePayload = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, payload);
    }

    #[test]
    fn payload_type_field_renamed() {
        let payload = test_payload();
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains(r#""type":"personal""#));
        assert!(!json.contains("license_type"));
    }

    #[test]
    fn is_expired_none_returns_false() {
        let payload = test_payload();
        assert!(!payload.is_expired(u64::MAX));
    }

    #[test]
    fn is_expired_before_expiry() {
        let mut payload = test_payload();
        payload.expires_at = Some(1000);
        assert!(!payload.is_expired(999));
    }

    #[test]
    fn is_expired_at_expiry() {
        let mut payload = test_payload();
        payload.expires_at = Some(1000);
        assert!(payload.is_expired(1000));
    }

    #[test]
    fn is_expired_after_expiry() {
        let mut payload = test_payload();
        payload.expires_at = Some(1000);
        assert!(payload.is_expired(1001));
    }

    // --- Cycle 2: sign_license_pem ---

    #[test]
    fn sign_license_pem_produces_valid_pem() {
        let sk = SigningKey::generate(&mut OsRng);
        let pem = sign_license_pem(&test_payload(), &sk);
        assert!(pem.starts_with(BEGIN_MARKER));
        assert!(pem.ends_with(END_MARKER));
        assert!(pem.contains('.'));
    }

    #[test]
    fn sign_license_pem_round_trips() {
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        let payload = test_payload();
        let pem = sign_license_pem(&payload, &sk);
        let decoded = verify_license_key(&pem, &vk).unwrap();
        assert_eq!(decoded, payload);
    }

    #[test]
    fn verify_rejects_wrong_key() {
        let sk1 = SigningKey::generate(&mut OsRng);
        let sk2 = SigningKey::generate(&mut OsRng);
        let pem = sign_license_pem(&test_payload(), &sk1);
        assert!(verify_license_key(&pem, &sk2.verifying_key()).is_err());
    }

    // --- Cycle 3: parse_duration ---

    #[test]
    fn parse_duration_days() {
        assert_eq!(parse_duration("1d").unwrap(), 86400);
        assert_eq!(parse_duration("7d").unwrap(), 604800);
    }

    #[test]
    fn parse_duration_hours() {
        assert_eq!(parse_duration("24h").unwrap(), 86400);
        assert_eq!(parse_duration("1h").unwrap(), 3600);
    }

    #[test]
    fn parse_duration_invalid() {
        assert!(parse_duration("").is_err());
        assert!(parse_duration("abc").is_err());
        assert!(parse_duration("5x").is_err());
        assert!(parse_duration("d").is_err());
    }

    // --- Cycle 4: parse_expires ---

    #[test]
    fn parse_expires_none_is_perpetual() {
        assert_eq!(parse_expires(None, 1000).unwrap(), None);
    }

    #[test]
    fn parse_expires_duration() {
        assert_eq!(parse_expires(Some("1d"), 1000).unwrap(), Some(87400));
    }

    #[test]
    fn parse_expires_epoch() {
        assert_eq!(
            parse_expires(Some("1749340800"), 1000).unwrap(),
            Some(1749340800)
        );
    }

    #[test]
    fn parse_expires_invalid() {
        assert!(parse_expires(Some("abc"), 1000).is_err());
    }

    // --- Cycle 5: parse_args ---

    #[test]
    fn parse_args_defaults() {
        let args = parse_args(&[]).unwrap();
        assert_eq!(args.name, "Dev Tester");
        assert_eq!(args.email, "dev@lit.solar");
        assert_eq!(args.expires, None);
        assert_eq!(args.license_type, "personal");
        assert!(args.license_id.is_none());
    }

    #[test]
    fn parse_args_all_flags() {
        let raw: Vec<String> = vec![
            "--name", "Alice",
            "--email", "alice@test.com",
            "--expires", "7d",
            "--type", "early_adopter",
            "--id", "lic-42",
            "--key", "/tmp/key.bin",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let args = parse_args(&raw).unwrap();
        assert_eq!(args.name, "Alice");
        assert_eq!(args.email, "alice@test.com");
        assert_eq!(args.expires, Some("7d".into()));
        assert_eq!(args.license_type, "early_adopter");
        assert_eq!(args.license_id, Some("lic-42".into()));
        assert_eq!(args.key_path, "/tmp/key.bin");
    }

    #[test]
    fn parse_args_unknown_flag() {
        let raw = vec!["--bogus".to_string()];
        assert!(parse_args(&raw).is_err());
    }

    #[test]
    fn parse_args_missing_value() {
        let raw = vec!["--name".to_string()];
        assert!(parse_args(&raw).is_err());
    }

    // --- Cycle 6: load_signing_key ---

    #[test]
    fn load_signing_key_valid() {
        let sk = SigningKey::generate(&mut OsRng);
        let f = write_temp_key(&sk);
        let loaded = load_signing_key(f.path()).unwrap();
        assert_eq!(loaded.to_bytes(), sk.to_bytes());
    }

    #[test]
    fn load_signing_key_wrong_length() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(&[0u8; 16]).unwrap();
        f.flush().unwrap();
        assert!(load_signing_key(f.path()).is_err());
    }

    #[test]
    fn load_signing_key_missing_file() {
        assert!(load_signing_key(Path::new("/nonexistent/key.bin")).is_err());
    }

    // --- Cycle 7: generate_key orchestrator ---

    #[test]
    fn generate_key_perpetual() {
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        let f = write_temp_key(&sk);
        let args = KeygenArgs {
            key_path: f.path().to_string_lossy().into_owned(),
            ..Default::default()
        };
        let pem = generate_key(&args, 1000).unwrap();
        let payload = verify_license_key(&pem, &vk).unwrap();
        assert_eq!(payload.expires_at, None);
        assert_eq!(payload.name, "Dev Tester");
        assert_eq!(payload.issued_at, 1000);
    }

    #[test]
    fn generate_key_duration_expiry() {
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        let f = write_temp_key(&sk);
        let args = KeygenArgs {
            expires: Some("1d".into()),
            key_path: f.path().to_string_lossy().into_owned(),
            ..Default::default()
        };
        let pem = generate_key(&args, 1000).unwrap();
        let payload = verify_license_key(&pem, &vk).unwrap();
        assert_eq!(payload.expires_at, Some(87400));
    }

    #[test]
    fn generate_key_epoch_expiry() {
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        let f = write_temp_key(&sk);
        let args = KeygenArgs {
            expires: Some("1749340800".into()),
            key_path: f.path().to_string_lossy().into_owned(),
            ..Default::default()
        };
        let pem = generate_key(&args, 1000).unwrap();
        let payload = verify_license_key(&pem, &vk).unwrap();
        assert_eq!(payload.expires_at, Some(1749340800));
    }

    #[test]
    fn generate_key_bad_key_file() {
        let args = KeygenArgs {
            key_path: "/nonexistent/key.bin".into(),
            ..Default::default()
        };
        assert!(generate_key(&args, 1000).is_err());
    }

    #[test]
    fn generate_key_custom_id() {
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        let f = write_temp_key(&sk);
        let args = KeygenArgs {
            license_id: Some("custom-id".into()),
            key_path: f.path().to_string_lossy().into_owned(),
            ..Default::default()
        };
        let pem = generate_key(&args, 1000).unwrap();
        let payload = verify_license_key(&pem, &vk).unwrap();
        assert_eq!(payload.license_id, "custom-id");
    }

    #[test]
    fn generate_key_default_id_includes_timestamp() {
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        let f = write_temp_key(&sk);
        let args = KeygenArgs {
            key_path: f.path().to_string_lossy().into_owned(),
            ..Default::default()
        };
        let pem = generate_key(&args, 42).unwrap();
        let payload = verify_license_key(&pem, &vk).unwrap();
        assert_eq!(payload.license_id, "dev-42");
    }

    // --- Cycle 8: real dev key round-trip ---

    #[test]
    fn real_dev_key_round_trip() {
        let keys_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../keys");
        let signing_path = keys_dir.join("dev_license_signing.bin");
        let verifying_path = keys_dir.join("dev_license_verifying.bin");

        if !signing_path.exists() || !verifying_path.exists() {
            eprintln!("Skipping real_dev_key_round_trip: key files not found");
            return;
        }

        let sk = load_signing_key(&signing_path).unwrap();
        let vk_bytes: [u8; 32] = std::fs::read(&verifying_path)
            .unwrap()
            .try_into()
            .unwrap();
        let verifying_key = VerifyingKey::from_bytes(&vk_bytes).unwrap();
        assert_eq!(sk.verifying_key().to_bytes(), vk_bytes, "key pair mismatch");

        let args = KeygenArgs {
            name: "Integration Test".into(),
            expires: Some("1d".into()),
            key_path: signing_path.to_string_lossy().into_owned(),
            ..Default::default()
        };
        let pem = generate_key(&args, 1700000000).unwrap();
        let payload = verify_license_key(&pem, &verifying_key).unwrap();
        assert_eq!(payload.name, "Integration Test");
        assert_eq!(payload.expires_at, Some(1700000000 + 86400));
    }
}
