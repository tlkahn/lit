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
        version: env!("LIT_GIT_VERSION").to_string(),
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
        assert!(!info.version.is_empty());

        // The bare `0.0.0` placeholder must never reach the UI: a git-absent
        // dev build (Docker, sandbox, shallow clone without tags) falls back in
        // build.rs to a clearly-labelled `0.0.0-dev`, not a fake "Lit v0.0.0"
        // release. See build.rs::resolve_dev_version.
        assert_ne!(
            info.version, "0.0.0",
            "bare 0.0.0 placeholder leaked into the UI version"
        );

        // The displayed version must never carry a `git describe` commit-sha
        // suffix (e.g. "0.12.0-5-gabcdef"). On release/CI builds it mirrors the
        // patched CARGO_PKG_VERSION; on dev builds build.rs uses
        // `git describe --tags --abbrev=0` (nearest tag, no suffix) to match the
        // CI "Sync version from git tag" step. Either way, an off-tag commit
        // hash here would mean the About dialog drifted from the bundle/DMG
        // version for the same binary.
        let has_git_sha = regex::Regex::new(r"-g[0-9a-f]{7,}")
            .unwrap()
            .is_match(&info.version);
        assert!(
            !has_git_sha,
            "version {:?} unexpectedly contains a git commit-sha suffix",
            info.version
        );

        // On release/CI builds, scripts/set-version.sh has patched the real
        // semver into Cargo.toml (so CARGO_PKG_VERSION != the 0.0.0
        // placeholder). In that case build.rs makes LIT_GIT_VERSION mirror
        // CARGO_PKG_VERSION, so the runtime version must equal the bundle
        // version — guarding against divergence between the About dialog and
        // the DMG/bundle metadata. In an unpatched local checkout (0.0.0) this
        // is a no-op, since LIT_GIT_VERSION falls back to `git describe`.
        if env!("CARGO_PKG_VERSION") != "0.0.0" {
            assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        }

        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["name"], "Lit");
        assert!(json["version"].as_str().map_or(false, |v| !v.is_empty()));
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
