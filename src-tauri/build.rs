use std::{env, fs, path::Path};

fn main() {
    ensure_placeholders();
    tauri_build::build();

    println!("cargo:rerun-if-env-changed=LIT_TRIAL_SIGNING_KEY_B64");
    println!("cargo:rerun-if-env-changed=LIT_LICENSE_VERIFYING_KEY_B64");

    let profile = env::var("PROFILE").unwrap();
    if profile != "debug" {
        embed_prod_key("LIT_TRIAL_SIGNING_KEY_B64", "prod_trial_signing.bin");
        embed_prod_key(
            "LIT_LICENSE_VERIFYING_KEY_B64",
            "prod_license_verifying.bin",
        );
    }
}

fn ensure_placeholders() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));

    let triple = env::var("TARGET").unwrap_or_else(|_| {
        env::var("CARGO_CFG_TARGET_ARCH")
            .map(|arch| format!("{arch}-apple-darwin"))
            .unwrap_or_else(|_| "aarch64-apple-darwin".into())
    });

    ensure_placeholders_in(manifest, &triple);
}

/// Create placeholder files for externalBin and resources so that
/// `tauri_build::build()` doesn't fail in worktrees or fresh checkouts
/// where gitignored artifacts haven't been fetched yet.
fn ensure_placeholders_in(base: &Path, triple: &str) {
    let placeholders = [
        base.join("binaries").join(format!("lit-cli-{triple}")),
        base.join("libs").join("libpdfium.dylib"),
    ];

    for path in &placeholders {
        if !path.exists() {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(path, []);
        }
    }
}

fn embed_prod_key(env_var: &str, filename: &str) {
    let b64 = env::var(env_var)
        .unwrap_or_else(|_| panic!("{env_var} must be set for release builds"));

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .unwrap_or_else(|e| panic!("{env_var}: invalid base64: {e}"));

    assert!(
        bytes.len() == 32,
        "{env_var}: expected 32 bytes, got {}",
        bytes.len()
    );

    let out_dir = env::var("OUT_DIR").unwrap();
    fs::write(Path::new(&out_dir).join(filename), &bytes).unwrap();
}
