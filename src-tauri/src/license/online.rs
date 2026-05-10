use std::path::Path;

use ed25519_dalek::VerifyingKey;
use serde::{Deserialize, Serialize};

use super::{key, storage};

const CACHE_FILE: &str = "validation_cache.json";
const CHECK_INTERVAL_SECS: u64 = 86400;
const BASE_URL: &str = "https://lit.solar";

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ValidationResponse {
    pub status: String,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OnlineValidationResult {
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ValidationCache {
    last_checked_at: u64,
}

#[allow(async_fn_in_trait)]
pub trait HttpClient: Send + Sync {
    async fn get_validation(&self, license_id: &str) -> Result<ValidationResponse, String>;
}

pub fn read_last_checked(dir: &Path) -> Option<u64> {
    let path = dir.join(CACHE_FILE);
    let contents = std::fs::read_to_string(path).ok()?;
    let cache: ValidationCache = serde_json::from_str(&contents).ok()?;
    Some(cache.last_checked_at)
}

pub fn write_last_checked(dir: &Path, ts: u64) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let cache = ValidationCache {
        last_checked_at: ts,
    };
    let json = serde_json::to_string_pretty(&cache).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(CACHE_FILE), json).map_err(|e| e.to_string())
}

pub fn should_check_today(dir: &Path, now: u64) -> bool {
    match read_last_checked(dir) {
        None => true,
        Some(last) => {
            if last > now {
                return true;
            }
            now - last >= CHECK_INTERVAL_SECS
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LicenseIdResult {
    Found(String),
    NoLicense,
    CorruptKey,
}

pub fn resolve_license_id(dir: &Path, verifying_key: &VerifyingKey) -> LicenseIdResult {
    let pem = match storage::read_license_key(dir) {
        Ok(Some(pem)) => pem,
        _ => return LicenseIdResult::NoLicense,
    };
    match key::verify_license_key(&pem, verifying_key) {
        Ok(payload) => LicenseIdResult::Found(payload.license_id),
        Err(_) => LicenseIdResult::CorruptKey,
    }
}

pub async fn perform_online_validation(
    dir: &Path,
    license_id: &str,
    now: u64,
    client: &impl HttpClient,
) -> OnlineValidationResult {
    match client.get_validation(license_id).await {
        Ok(resp) if resp.status == "revoked" => {
            tracing::info!(license_id, reason = ?resp.reason, "license revoked by server");
            let _ = storage::remove_license_key(dir);
            let _ = write_last_checked(dir, now);
            OnlineValidationResult {
                action: "revoked".into(),
                reason: resp.reason,
            }
        }
        Ok(_) => {
            tracing::debug!(license_id, "license valid");
            let _ = write_last_checked(dir, now);
            OnlineValidationResult {
                action: "valid".into(),
                reason: None,
            }
        }
        Err(e) => {
            tracing::debug!(error = %e, "online validation skipped: network error");
            OnlineValidationResult {
                action: "skipped".into(),
                reason: Some("network_error".into()),
            }
        }
    }
}

pub async fn check_validation_if_due(
    dir: &Path,
    verifying_key: &VerifyingKey,
    now: u64,
    client: &impl HttpClient,
) -> OnlineValidationResult {
    if !should_check_today(dir, now) {
        tracing::debug!("online validation not due");
        return OnlineValidationResult {
            action: "skipped".into(),
            reason: Some("not_due".into()),
        };
    }

    let license_id = match resolve_license_id(dir, verifying_key) {
        LicenseIdResult::Found(id) => id,
        LicenseIdResult::NoLicense => {
            tracing::debug!("online validation skipped: no license file");
            return OnlineValidationResult {
                action: "skipped".into(),
                reason: Some("no_license".into()),
            };
        }
        LicenseIdResult::CorruptKey => {
            tracing::debug!("online validation skipped: corrupt license key");
            return OnlineValidationResult {
                action: "skipped".into(),
                reason: Some("corrupt_key".into()),
            };
        }
    };

    perform_online_validation(dir, &license_id, now, client).await
}

fn get_base_url() -> String {
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("LIT_VALIDATE_URL") {
        return url;
    }
    BASE_URL.to_string()
}

pub struct ReqwestHttpClient {
    client: reqwest::Client,
}

impl ReqwestHttpClient {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("failed to build reqwest client");
        Self { client }
    }
}

impl HttpClient for ReqwestHttpClient {
    async fn get_validation(&self, license_id: &str) -> Result<ValidationResponse, String> {
        let url = format!("{}/api/validate", get_base_url());
        let resp = self
            .client
            .get(&url)
            .query(&[("license_id", license_id)])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = resp.status();
        if !status.is_success() {
            return Err(format!("server returned {}", status));
        }
        resp.json::<ValidationResponse>()
            .await
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use rand::rngs::OsRng;

    // --- MockHttpClient ---

    struct MockHttpClient {
        response: Result<ValidationResponse, String>,
    }

    impl MockHttpClient {
        fn valid() -> Self {
            Self {
                response: Ok(ValidationResponse {
                    status: "valid".into(),
                    reason: None,
                }),
            }
        }

        fn revoked(reason: &str) -> Self {
            Self {
                response: Ok(ValidationResponse {
                    status: "revoked".into(),
                    reason: Some(reason.into()),
                }),
            }
        }

        fn error(msg: &str) -> Self {
            Self {
                response: Err(msg.into()),
            }
        }
    }

    impl HttpClient for MockHttpClient {
        async fn get_validation(&self, _license_id: &str) -> Result<ValidationResponse, String> {
            self.response.clone()
        }
    }

    fn build_test_pem(payload: &key::LicensePayload, signing_key: &SigningKey) -> String {
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

    // --- A1: Types ---

    #[test]
    fn deserialize_valid_response() {
        let json = r#"{"status":"valid"}"#;
        let resp: ValidationResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.status, "valid");
        assert_eq!(resp.reason, None);
    }

    #[test]
    fn deserialize_revoked_response() {
        let json = r#"{"status":"revoked","reason":"refund"}"#;
        let resp: ValidationResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.status, "revoked");
        assert_eq!(resp.reason, Some("refund".into()));
    }

    #[test]
    fn online_validation_result_serializes() {
        let result = OnlineValidationResult {
            action: "valid".into(),
            reason: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"action\":\"valid\""));
        assert!(!json.contains("reason"));
    }

    #[test]
    fn online_validation_result_with_reason_serializes() {
        let result = OnlineValidationResult {
            action: "skipped".into(),
            reason: Some("not_due".into()),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"action\":\"skipped\""));
        assert!(json.contains("\"reason\":\"not_due\""));
    }

    // --- A2: MockHttpClient ---

    #[tokio::test]
    async fn mock_returns_valid() {
        let client = MockHttpClient::valid();
        let resp = client.get_validation("lic-1").await.unwrap();
        assert_eq!(resp.status, "valid");
    }

    #[tokio::test]
    async fn mock_returns_revoked() {
        let client = MockHttpClient::revoked("refund");
        let resp = client.get_validation("lic-1").await.unwrap();
        assert_eq!(resp.status, "revoked");
        assert_eq!(resp.reason, Some("refund".into()));
    }

    #[tokio::test]
    async fn mock_returns_error() {
        let client = MockHttpClient::error("timeout");
        let err = client.get_validation("lic-1").await.unwrap_err();
        assert_eq!(err, "timeout");
    }

    // --- A3: Cache ---

    #[test]
    fn cache_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        write_last_checked(dir.path(), 1000).unwrap();
        assert_eq!(read_last_checked(dir.path()), Some(1000));
    }

    #[test]
    fn cache_missing_file_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_last_checked(dir.path()), None);
    }

    #[test]
    fn cache_corrupt_file_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(CACHE_FILE), "not json").unwrap();
        assert_eq!(read_last_checked(dir.path()), None);
    }

    // --- A4: Rate limiting ---

    #[test]
    fn should_check_never_checked() {
        let dir = tempfile::tempdir().unwrap();
        assert!(should_check_today(dir.path(), 1000));
    }

    #[test]
    fn should_check_recently_checked() {
        let dir = tempfile::tempdir().unwrap();
        let now = 100_000u64;
        write_last_checked(dir.path(), now - 3600).unwrap();
        assert!(!should_check_today(dir.path(), now));
    }

    #[test]
    fn should_check_over_24h_ago() {
        let dir = tempfile::tempdir().unwrap();
        let now = 200_000u64;
        write_last_checked(dir.path(), now - 86401).unwrap();
        assert!(should_check_today(dir.path(), now));
    }

    #[test]
    fn should_check_corrupt_cache() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(CACHE_FILE), "garbage").unwrap();
        assert!(should_check_today(dir.path(), 1000));
    }

    #[test]
    fn should_check_future_timestamp_treated_as_stale() {
        let dir = tempfile::tempdir().unwrap();
        let now = 100_000u64;
        write_last_checked(dir.path(), now + 999_999).unwrap();
        assert!(should_check_today(dir.path(), now));
    }

    // --- A5: Happy path (valid) ---

    #[tracing_test::traced_test]
    #[tokio::test]
    async fn perform_validation_valid() {
        let dir = tempfile::tempdir().unwrap();
        let client = MockHttpClient::valid();
        let now = 500_000u64;
        let result = perform_online_validation(dir.path(), "lic-1", now, &client).await;
        assert_eq!(result.action, "valid");
        assert_eq!(read_last_checked(dir.path()), Some(now));
        assert!(logs_contain("license valid"));
    }

    // --- A6: Revocation ---

    #[tracing_test::traced_test]
    #[tokio::test]
    async fn perform_validation_revoked_deletes_license() {
        let dir = tempfile::tempdir().unwrap();
        storage::write_license_key(dir.path(), "some-key").unwrap();
        let client = MockHttpClient::revoked("refund");
        let now = 500_000u64;
        let result = perform_online_validation(dir.path(), "lic-1", now, &client).await;
        assert_eq!(result.action, "revoked");
        assert_eq!(result.reason, Some("refund".into()));
        assert!(storage::read_license_key(dir.path()).unwrap().is_none());
        assert_eq!(read_last_checked(dir.path()), Some(now));
        assert!(logs_contain("license revoked"));
    }

    // --- A7: Network error ---

    #[tracing_test::traced_test]
    #[tokio::test]
    async fn perform_validation_network_error_skips() {
        let dir = tempfile::tempdir().unwrap();
        storage::write_license_key(dir.path(), "some-key").unwrap();
        let client = MockHttpClient::error("connection refused");
        let now = 500_000u64;
        let result = perform_online_validation(dir.path(), "lic-1", now, &client).await;
        assert_eq!(result.action, "skipped");
        assert_eq!(read_last_checked(dir.path()), None);
        assert!(storage::read_license_key(dir.path()).unwrap().is_some());
        assert!(logs_contain("online validation skipped"));
    }

    // --- A8: Orchestrator ---

    #[tracing_test::traced_test]
    #[tokio::test]
    async fn orchestrator_skips_when_not_due() {
        let dir = tempfile::tempdir().unwrap();
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        let now = 100_000u64;
        write_last_checked(dir.path(), now - 100).unwrap();
        let client = MockHttpClient::valid();
        let result = check_validation_if_due(dir.path(), &vk, now, &client).await;
        assert_eq!(result.action, "skipped");
        assert_eq!(result.reason, Some("not_due".into()));
        assert!(logs_contain("online validation not due"));
    }

    #[tokio::test]
    async fn orchestrator_skips_when_no_license() {
        let dir = tempfile::tempdir().unwrap();
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        let now = 100_000u64;
        let client = MockHttpClient::valid();
        let result = check_validation_if_due(dir.path(), &vk, now, &client).await;
        assert_eq!(result.action, "skipped");
        assert_eq!(result.reason, Some("no_license".into()));
    }

    #[tokio::test]
    async fn orchestrator_skips_when_corrupt_key() {
        let dir = tempfile::tempdir().unwrap();
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        storage::write_license_key(dir.path(), "garbage").unwrap();
        let now = 100_000u64;
        let client = MockHttpClient::valid();
        let result = check_validation_if_due(dir.path(), &vk, now, &client).await;
        assert_eq!(result.action, "skipped");
        assert_eq!(result.reason, Some("corrupt_key".into()));
    }

    #[tokio::test]
    async fn orchestrator_proceeds_when_due_with_valid_key() {
        let dir = tempfile::tempdir().unwrap();
        let lic_sk = SigningKey::generate(&mut OsRng);
        let lic_vk = lic_sk.verifying_key();
        let payload = key::LicensePayload {
            license_id: "lic-test-1".into(),
            name: "Test".into(),
            email: "t@e.com".into(),
            issued_at: 100,
            license_type: "personal".into(),
        };
        let pem = build_test_pem(&payload, &lic_sk);
        storage::write_license_key(dir.path(), &pem).unwrap();
        let now = 100_000u64;
        let client = MockHttpClient::valid();
        let result = check_validation_if_due(dir.path(), &lic_vk, now, &client).await;
        assert_eq!(result.action, "valid");
        assert_eq!(read_last_checked(dir.path()), Some(now));
    }

    // --- A9: ReqwestHttpClient ---

    fn assert_is_http_client<T: HttpClient>(_: &T) {}

    #[test]
    fn reqwest_client_implements_trait() {
        let client = ReqwestHttpClient::new();
        assert_is_http_client(&client);
    }

    // --- A10: resolve_license_id ---

    #[test]
    fn resolve_license_id_valid_key() {
        let dir = tempfile::tempdir().unwrap();
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        let payload = key::LicensePayload {
            license_id: "lic-test-1".into(),
            name: "Test".into(),
            email: "t@e.com".into(),
            issued_at: 100,
            license_type: "personal".into(),
        };
        let pem = build_test_pem(&payload, &sk);
        storage::write_license_key(dir.path(), &pem).unwrap();
        assert_eq!(
            resolve_license_id(dir.path(), &vk),
            LicenseIdResult::Found("lic-test-1".into())
        );
    }

    #[test]
    fn resolve_license_id_no_license_file() {
        let dir = tempfile::tempdir().unwrap();
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        assert_eq!(resolve_license_id(dir.path(), &vk), LicenseIdResult::NoLicense);
    }

    #[test]
    fn resolve_license_id_corrupt_key() {
        let dir = tempfile::tempdir().unwrap();
        let sk = SigningKey::generate(&mut OsRng);
        let vk = sk.verifying_key();
        storage::write_license_key(dir.path(), "garbage").unwrap();
        assert_eq!(resolve_license_id(dir.path(), &vk), LicenseIdResult::CorruptKey);
    }
}
