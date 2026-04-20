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
}
