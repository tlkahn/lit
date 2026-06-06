use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Lit".to_string(),
        version: "0.1.0".to_string(),
    }
}

/// Where this binary was built/distributed for. `app_store` builds must hide
/// in-app purchase affordances (e.g. the "Buy License" button) to comply with
/// App Store Review Guideline 3.1.1; `direct` builds may show them. Decided at
/// compile time via the `app-store` Cargo feature so it is independent of any
/// license key's origin (which is unknown when unlicensed).
#[derive(Debug, Serialize)]
pub struct BuildInfo {
    pub source: String,
}

#[tauri::command]
pub fn get_build_info() -> BuildInfo {
    #[cfg(feature = "app-store")]
    {
        BuildInfo {
            source: "app_store".to_string(),
        }
    }
    #[cfg(not(feature = "app-store"))]
    {
        BuildInfo {
            source: "direct".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_app_info() {
        let info = get_app_info();
        assert_eq!(info.name, "Lit");
        assert_eq!(info.version, "0.1.0");

        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["name"], "Lit");
        assert_eq!(json["version"], "0.1.0");
    }

    #[cfg(not(feature = "app-store"))]
    #[test]
    fn get_build_info_default_is_direct() {
        let info = get_build_info();
        assert_eq!(info.source, "direct");

        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["source"], "direct");
    }

    #[cfg(feature = "app-store")]
    #[test]
    fn get_build_info_app_store_under_feature() {
        let info = get_build_info();
        assert_eq!(info.source, "app_store");

        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["source"], "app_store");
    }
}
