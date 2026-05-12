use std::{env, fs, path::Path};

fn main() {
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
