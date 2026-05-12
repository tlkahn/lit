use std::path::PathBuf;

use ed25519_dalek::{SigningKey, VerifyingKey};
use serde::Serialize;
use tauri::State;

use crate::license::{self, online::{self, OnlineValidationResult, ReqwestHttpClient}};

pub struct LicenseManager {
    pub data_dir: PathBuf,
    pub trial_signing_key: SigningKey,
    pub license_verifying_key: VerifyingKey,
}

#[derive(Debug, Clone, Serialize)]
pub struct LicenseStatusResponse {
    pub state: String,
    pub days_remaining: Option<u64>,
    pub licensed_to: Option<String>,
}

impl LicenseStatusResponse {
    fn from_dev_override(ov: license::DevOverride) -> Self {
        match ov {
            license::DevOverride::Trial => Self {
                state: "trial".into(),
                days_remaining: Some(license::trial::TRIAL_DURATION_SECS / 86400),
                licensed_to: None,
            },
            license::DevOverride::TrialShort => Self {
                state: "trial".into(),
                days_remaining: Some(0),
                licensed_to: None,
            },
            license::DevOverride::TrialExpired => Self {
                state: "expired".into(),
                days_remaining: Some(0),
                licensed_to: None,
            },
            license::DevOverride::Licensed => Self {
                state: "licensed".into(),
                days_remaining: None,
                licensed_to: Some("Dev Mode".into()),
            },
        }
    }

    fn from_status(status: &license::LicenseStatus) -> Self {
        match status {
            license::LicenseStatus::Trial(license::trial::TrialState::Active { days_left }) => {
                Self {
                    state: "trial".into(),
                    days_remaining: Some(*days_left),
                    licensed_to: None,
                }
            }
            license::LicenseStatus::Trial(license::trial::TrialState::ExpiringSoon {
                days_left,
            }) => Self {
                state: "expiring_soon".into(),
                days_remaining: Some(*days_left),
                licensed_to: None,
            },
            license::LicenseStatus::Trial(license::trial::TrialState::Expired) => Self {
                state: "expired".into(),
                days_remaining: Some(0),
                licensed_to: None,
            },
            license::LicenseStatus::Licensed(payload) => Self {
                state: "licensed".into(),
                days_remaining: None,
                licensed_to: Some(payload.name.clone()),
            },
            license::LicenseStatus::Expired => Self {
                state: "expired".into(),
                days_remaining: Some(0),
                licensed_to: None,
            },
        }
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

#[tauri::command]
pub fn get_license_status(
    state: State<'_, LicenseManager>,
) -> Result<LicenseStatusResponse, String> {
    #[cfg(debug_assertions)]
    if let Some(ov) = license::dev_mode_override() {
        return Ok(LicenseStatusResponse::from_dev_override(ov));
    }

    let status = license::get_status(
        &state.data_dir,
        &state.trial_signing_key,
        &state.license_verifying_key,
        now_secs(),
    );
    Ok(LicenseStatusResponse::from_status(&status))
}

#[tauri::command]
pub fn activate_license(
    key: String,
    state: State<'_, LicenseManager>,
) -> Result<LicenseStatusResponse, String> {
    license::key::verify_license_key(&key, &state.license_verifying_key)
        .map_err(|e| e.to_string())?;
    license::storage::write_license_key(&state.data_dir, &key).map_err(|e| e.to_string())?;
    let status = license::get_status(
        &state.data_dir,
        &state.trial_signing_key,
        &state.license_verifying_key,
        now_secs(),
    );
    Ok(LicenseStatusResponse::from_status(&status))
}

#[tauri::command]
pub async fn check_online_validation(
    state: State<'_, LicenseManager>,
) -> Result<OnlineValidationResult, String> {
    let now = now_secs();
    if !online::should_check_today(&state.data_dir, now) {
        return Ok(OnlineValidationResult {
            action: "skipped".into(),
            reason: Some("not_due".into()),
        });
    }
    let license_id = match online::resolve_license_id(
        &state.data_dir,
        &state.license_verifying_key,
    ) {
        online::LicenseIdResult::Found(id) => id,
        online::LicenseIdResult::NoLicense => {
            return Ok(OnlineValidationResult {
                action: "skipped".into(),
                reason: Some("no_license".into()),
            });
        }
        online::LicenseIdResult::CorruptKey => {
            return Ok(OnlineValidationResult {
                action: "skipped".into(),
                reason: Some("corrupt_key".into()),
            });
        }
    };
    let client = ReqwestHttpClient::new();
    Ok(online::perform_online_validation(&state.data_dir, &license_id, now, &client).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn license_status_response_trial_json() {
        let resp = LicenseStatusResponse {
            state: "trial".into(),
            days_remaining: Some(10),
            licensed_to: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"state\":\"trial\""));
        assert!(json.contains("\"days_remaining\":10"));
        assert!(json.contains("\"licensed_to\":null"));
    }

    #[test]
    fn license_status_response_licensed_json() {
        let resp = LicenseStatusResponse {
            state: "licensed".into(),
            days_remaining: None,
            licensed_to: Some("User".into()),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"state\":\"licensed\""));
        assert!(json.contains("\"licensed_to\":\"User\""));
    }

    #[test]
    fn license_status_response_expired_json() {
        let resp = LicenseStatusResponse {
            state: "expired".into(),
            days_remaining: Some(0),
            licensed_to: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"state\":\"expired\""));
    }

    #[test]
    fn online_validation_result_serializes() {
        let result = OnlineValidationResult {
            action: "skipped".into(),
            reason: Some("not_due".into()),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"action\":\"skipped\""));
        assert!(json.contains("\"reason\":\"not_due\""));
    }

    #[test]
    fn license_manager_construction() {
        let sk = SigningKey::from_bytes(license::TRIAL_SIGNING_KEY_BYTES);
        let vk = VerifyingKey::from_bytes(license::LICENSE_VERIFYING_KEY_BYTES).unwrap();
        let mgr = LicenseManager {
            data_dir: PathBuf::from("/tmp"),
            trial_signing_key: sk,
            license_verifying_key: vk,
        };
        assert_eq!(
            mgr.trial_signing_key.verifying_key().to_bytes().len(),
            32
        );
    }

    #[test]
    fn dev_override_trial_response() {
        let resp = LicenseStatusResponse::from_dev_override(license::DevOverride::Trial);
        assert_eq!(resp.state, "trial");
        assert_eq!(resp.days_remaining, Some(14));
        assert_eq!(resp.licensed_to, None);
    }

    #[test]
    fn dev_override_trial_short_response() {
        let resp = LicenseStatusResponse::from_dev_override(license::DevOverride::TrialShort);
        assert_eq!(resp.state, "trial");
        assert_eq!(resp.days_remaining, Some(0));
        assert_eq!(resp.licensed_to, None);
    }

    #[test]
    fn dev_override_trial_expired_response() {
        let resp = LicenseStatusResponse::from_dev_override(license::DevOverride::TrialExpired);
        assert_eq!(resp.state, "expired");
        assert_eq!(resp.days_remaining, Some(0));
        assert_eq!(resp.licensed_to, None);
    }

    #[test]
    fn dev_override_licensed_response() {
        let resp = LicenseStatusResponse::from_dev_override(license::DevOverride::Licensed);
        assert_eq!(resp.state, "licensed");
        assert_eq!(resp.days_remaining, None);
        assert_eq!(resp.licensed_to, Some("Dev Mode".into()));
    }

    #[test]
    fn from_status_active_trial() {
        let status =
            license::LicenseStatus::Trial(license::trial::TrialState::Active { days_left: 7 });
        let resp = LicenseStatusResponse::from_status(&status);
        assert_eq!(resp.state, "trial");
        assert_eq!(resp.days_remaining, Some(7));
    }

    #[test]
    fn from_status_expiring_soon() {
        let status = license::LicenseStatus::Trial(license::trial::TrialState::ExpiringSoon {
            days_left: 2,
        });
        let resp = LicenseStatusResponse::from_status(&status);
        assert_eq!(resp.state, "expiring_soon");
        assert_eq!(resp.days_remaining, Some(2));
    }

    #[test]
    fn from_status_licensed() {
        let payload = license::key::LicensePayload {
            license_id: "lic-1".into(),
            name: "User".into(),
            email: "u@e.com".into(),
            issued_at: 100,
            license_type: "personal".into(),
        };
        let status = license::LicenseStatus::Licensed(payload);
        let resp = LicenseStatusResponse::from_status(&status);
        assert_eq!(resp.state, "licensed");
        assert_eq!(resp.licensed_to, Some("User".into()));
    }
}
