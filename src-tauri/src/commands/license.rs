use std::path::PathBuf;

use ed25519_dalek::VerifyingKey;
use serde::Serialize;
use tauri::menu::MenuItemKind;
use tauri::{AppHandle, State, Wry};

use crate::license::{self, online::{self, OnlineValidationResult, ReqwestHttpClient}};
use crate::menu::{MENU_ID_BUY_LICENSE, MENU_ID_ENTER_LICENSE_KEY, MENU_ID_LICENSE_INFO};

pub struct LicenseManager {
    pub data_dir: PathBuf,
    pub license_verifying_key: VerifyingKey,
}

#[derive(Debug, Clone, Serialize)]
pub struct LicenseStatusResponse {
    pub state: String,
    pub licensed_to: Option<String>,
    pub source: Option<String>,
    pub expires_at: Option<u64>,
    pub expiry_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

fn source_to_string(source: &license::key::LicenseSource) -> String {
    match source {
        license::key::LicenseSource::Direct => "direct".into(),
    }
}

/// Format a Unix epoch timestamp (seconds) as a UTC `YYYY-MM-DD` date string.
///
/// Pure-Rust implementation of Howard Hinnant's civil-from-days algorithm,
/// avoiding a `chrono`/`time` direct dependency.
fn format_expiry_date(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    // Shift epoch from 1970-01-01 to 0000-03-01 (era-based algorithm).
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let year = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", year, m, d)
}

impl LicenseStatusResponse {
    fn from_dev_override(ov: license::DevOverride) -> Self {
        match ov {
            license::DevOverride::Unlicensed => Self {
                state: "unlicensed".into(),
                licensed_to: None,
                source: None,
                expires_at: None,
                expiry_date: None,
                reason: None,
            },
            license::DevOverride::Licensed => Self {
                state: "licensed".into(),
                licensed_to: Some("Dev Mode".into()),
                source: Some("direct".into()),
                expires_at: None,
                expiry_date: None,
                reason: None,
            },
            license::DevOverride::LicenseExpired => Self {
                state: "license_expired".into(),
                licensed_to: Some("Dev User".into()),
                source: Some("direct".into()),
                expires_at: Some(1735603200),
                expiry_date: Some(format_expiry_date(1735603200)),
                reason: None,
            },
            license::DevOverride::Revoked => Self {
                state: "revoked".into(),
                licensed_to: None,
                source: None,
                expires_at: None,
                expiry_date: None,
                reason: Some("dev_revoked".into()),
            },
        }
    }

    fn from_status(status: &license::LicenseStatus) -> Self {
        match status {
            license::LicenseStatus::Unlicensed => Self {
                state: "unlicensed".into(),
                licensed_to: None,
                source: None,
                expires_at: None,
                expiry_date: None,
                reason: None,
            },
            license::LicenseStatus::Licensed(payload) => Self {
                state: "licensed".into(),
                licensed_to: Some(payload.name.clone()),
                source: Some(source_to_string(&payload.source)),
                expires_at: payload.expires_at,
                expiry_date: payload.expires_at.map(format_expiry_date),
                reason: None,
            },
            license::LicenseStatus::LicenseExpired { payload, expired_at } => Self {
                state: "license_expired".into(),
                licensed_to: Some(payload.name.clone()),
                source: Some(source_to_string(&payload.source)),
                expires_at: Some(*expired_at),
                expiry_date: Some(format_expiry_date(*expired_at)),
                reason: None,
            },
            license::LicenseStatus::Revoked { reason } => Self {
                state: "revoked".into(),
                licensed_to: None,
                source: None,
                expires_at: None,
                expiry_date: None,
                reason: reason.clone(),
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
    let status = license::activate_key(
        &state.data_dir,
        &key,
        &state.license_verifying_key,
        now_secs(),
    )
    .map_err(|e| e.to_string())?;
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

fn set_item_enabled(menu: &tauri::menu::Menu<Wry>, id: &str, enabled: bool) -> Result<(), String> {
    for item in menu.items().map_err(|e| e.to_string())? {
        if let MenuItemKind::Submenu(sub) = &item {
            if let Some(MenuItemKind::MenuItem(mi)) = sub.get(id) {
                return mi.set_enabled(enabled).map_err(|e| e.to_string());
            }
        }
    }
    Ok(())
}

/// Whether the "Buy License" menu item should be enabled for the given state.
fn buy_enabled_for(license_state: &str) -> bool {
    matches!(license_state, "unlicensed" | "license_expired" | "revoked")
}

#[tauri::command]
pub fn sync_license_menu(app: AppHandle, license_state: String) -> Result<(), String> {
    let menu = app.menu().ok_or("no app menu")?;

    let buy_enabled = buy_enabled_for(license_state.as_str());
    let enter_enabled = license_state != "licensed";
    let info_enabled = license_state == "licensed";

    set_item_enabled(&menu, MENU_ID_BUY_LICENSE, buy_enabled)?;
    set_item_enabled(&menu, MENU_ID_ENTER_LICENSE_KEY, enter_enabled)?;
    set_item_enabled(&menu, MENU_ID_LICENSE_INFO, info_enabled)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn license_status_response_licensed_json_has_new_fields() {
        let resp = LicenseStatusResponse {
            state: "licensed".into(),
            licensed_to: Some("User".into()),
            source: Some("direct".into()),
            expires_at: Some(1735603200),
            expiry_date: Some("2024-12-31".into()),
            reason: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"state\":\"licensed\""));
        assert!(json.contains("\"licensed_to\":\"User\""));
        assert!(json.contains("\"source\":\"direct\""));
        assert!(json.contains("\"expires_at\":1735603200"));
        assert!(json.contains("\"expiry_date\":\"2024-12-31\""));
        assert!(!json.contains("days_remaining"));
    }

    #[test]
    fn license_status_response_unlicensed_json() {
        let resp = LicenseStatusResponse {
            state: "unlicensed".into(),
            licensed_to: None,
            source: None,
            expires_at: None,
            expiry_date: None,
            reason: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"state\":\"unlicensed\""));
        assert!(json.contains("\"licensed_to\":null"));
        assert!(json.contains("\"source\":null"));
        assert!(json.contains("\"expires_at\":null"));
        assert!(json.contains("\"expiry_date\":null"));
        assert!(!json.contains("days_remaining"));
    }

    #[test]
    fn license_status_response_license_expired_json() {
        let resp = LicenseStatusResponse {
            state: "license_expired".into(),
            licensed_to: Some("User".into()),
            source: Some("direct".into()),
            expires_at: Some(1735603200),
            expiry_date: Some("2024-12-31".into()),
            reason: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"state\":\"license_expired\""));
        assert!(json.contains("\"expiry_date\":\"2024-12-31\""));
        assert!(!json.contains("days_remaining"));
    }

    #[test]
    fn format_expiry_date_known_timestamp() {
        assert_eq!(format_expiry_date(1735603200), "2024-12-31");
    }

    #[test]
    fn format_expiry_date_epoch_zero() {
        assert_eq!(format_expiry_date(0), "1970-01-01");
    }

    #[test]
    fn buy_enabled_for_states() {
        assert!(buy_enabled_for("unlicensed"));
        assert!(buy_enabled_for("license_expired"));
        assert!(buy_enabled_for("revoked"));
        assert!(!buy_enabled_for("licensed"));
    }

    #[test]
    fn from_status_revoked_includes_reason() {
        let status = license::LicenseStatus::Revoked {
            reason: Some("refund".into()),
        };
        let resp = LicenseStatusResponse::from_status(&status);
        assert_eq!(resp.state, "revoked");
        assert_eq!(resp.licensed_to, None);
        assert_eq!(resp.source, None);
        assert_eq!(resp.expires_at, None);
        assert_eq!(resp.expiry_date, None);
        assert_eq!(resp.reason, Some("refund".into()));
    }

    #[test]
    fn from_status_revoked_none_reason() {
        let status = license::LicenseStatus::Revoked { reason: None };
        let resp = LicenseStatusResponse::from_status(&status);
        assert_eq!(resp.state, "revoked");
        assert_eq!(resp.reason, None);
    }

    #[test]
    fn from_status_revoked_json_includes_reason() {
        let status = license::LicenseStatus::Revoked {
            reason: Some("refund".into()),
        };
        let resp = LicenseStatusResponse::from_status(&status);
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"reason\":\"refund\""));
    }

    #[test]
    fn from_status_unlicensed_json_omits_reason() {
        let resp = LicenseStatusResponse::from_status(&license::LicenseStatus::Unlicensed);
        let json = serde_json::to_string(&resp).unwrap();
        assert!(!json.contains("reason"));
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
        let vk = VerifyingKey::from_bytes(license::LICENSE_VERIFYING_KEY_BYTES).unwrap();
        let mgr = LicenseManager {
            data_dir: PathBuf::from("/tmp"),
            license_verifying_key: vk,
        };
        assert_eq!(mgr.license_verifying_key.to_bytes().len(), 32);
    }

    #[test]
    fn dev_override_unlicensed_response() {
        let resp = LicenseStatusResponse::from_dev_override(license::DevOverride::Unlicensed);
        assert_eq!(resp.state, "unlicensed");
        assert_eq!(resp.licensed_to, None);
        assert_eq!(resp.source, None);
        assert_eq!(resp.expires_at, None);
        assert_eq!(resp.expiry_date, None);
    }

    #[test]
    fn dev_override_license_expired_response() {
        let resp = LicenseStatusResponse::from_dev_override(license::DevOverride::LicenseExpired);
        assert_eq!(resp.state, "license_expired");
        assert_eq!(resp.licensed_to, Some("Dev User".into()));
        assert_eq!(resp.source, Some("direct".into()));
        assert_eq!(resp.expires_at, Some(1735603200));
        assert_eq!(resp.expiry_date, Some("2024-12-31".into()));
    }

    #[test]
    fn dev_override_licensed_response() {
        let resp = LicenseStatusResponse::from_dev_override(license::DevOverride::Licensed);
        assert_eq!(resp.state, "licensed");
        assert_eq!(resp.licensed_to, Some("Dev Mode".into()));
        assert_eq!(resp.source, Some("direct".into()));
        assert_eq!(resp.expires_at, None);
        assert_eq!(resp.expiry_date, None);
    }

    #[test]
    fn dev_override_revoked_response() {
        let resp = LicenseStatusResponse::from_dev_override(license::DevOverride::Revoked);
        assert_eq!(resp.state, "revoked");
        assert_eq!(resp.licensed_to, None);
        assert_eq!(resp.source, None);
        assert_eq!(resp.expires_at, None);
        assert_eq!(resp.expiry_date, None);
        assert_eq!(resp.reason, Some("dev_revoked".into()));
    }

    fn sample_payload(expires_at: Option<u64>) -> license::key::LicensePayload {
        sample_payload_with_source(expires_at, license::key::LicenseSource::Direct)
    }

    fn sample_payload_with_source(
        expires_at: Option<u64>,
        source: license::key::LicenseSource,
    ) -> license::key::LicensePayload {
        license::key::LicensePayload {
            license_id: "lic-1".into(),
            name: "User".into(),
            email: "u@e.com".into(),
            issued_at: 100,
            license_type: "personal".into(),
            expires_at,
            source,
        }
    }

    #[test]
    fn from_status_unlicensed() {
        let resp = LicenseStatusResponse::from_status(&license::LicenseStatus::Unlicensed);
        assert_eq!(resp.state, "unlicensed");
        assert_eq!(resp.licensed_to, None);
        assert_eq!(resp.source, None);
        assert_eq!(resp.expires_at, None);
        assert_eq!(resp.expiry_date, None);
    }

    #[test]
    fn from_status_licensed() {
        let status = license::LicenseStatus::Licensed(sample_payload(None));
        let resp = LicenseStatusResponse::from_status(&status);
        assert_eq!(resp.state, "licensed");
        assert_eq!(resp.licensed_to, Some("User".into()));
        assert_eq!(resp.source, Some("direct".into()));
        assert_eq!(resp.expires_at, None);
        assert_eq!(resp.expiry_date, None);
    }

    #[test]
    fn from_status_licensed_with_expiry() {
        let status = license::LicenseStatus::Licensed(sample_payload_with_source(
            Some(1735603200),
            license::key::LicenseSource::Direct,
        ));
        let resp = LicenseStatusResponse::from_status(&status);
        assert_eq!(resp.state, "licensed");
        assert_eq!(resp.source, Some("direct".into()));
        assert_eq!(resp.expires_at, Some(1735603200));
        assert_eq!(resp.expiry_date, Some("2024-12-31".into()));
    }

    #[test]
    fn from_status_license_expired() {
        let status = license::LicenseStatus::LicenseExpired {
            payload: sample_payload(Some(1735603200)),
            expired_at: 1735603200,
        };
        let resp = LicenseStatusResponse::from_status(&status);
        assert_eq!(resp.state, "license_expired");
        assert_eq!(resp.licensed_to, Some("User".into()));
        assert_eq!(resp.source, Some("direct".into()));
        assert_eq!(resp.expires_at, Some(1735603200));
        assert_eq!(resp.expiry_date, Some("2024-12-31".into()));
    }
}
