//! Tests for `build.rs`'s `free_distribution.pem` cryptographic verification.
//!
//! Build scripts are a separate compilation unit, so their `#[cfg(test)]`
//! modules never run under `cargo test`. Following the same convention as
//! `tests/resolve_dev_version.rs`, `tests/git_rerun_paths.rs`, and
//! `tests/ensure_placeholders.rs`, the pure helper below is a mirror of the
//! `build.rs` original and must be kept in sync manually (enforced by
//! release.bats's SYNC-marker test).
//!
//! The embedded `src-tauri/keys/free_distribution.pem` is what every build
//! (and therefore every install) grants free access from. If it is signed with
//! a different key than the one the build embeds (debug: `dev_license_verifying.bin`,
//! release: `LIT_LICENSE_VERIFYING_KEY_B64`), `ensure_free_grant` swallows the
//! failure and ships an Unlicensed app with no in-app path to fix it. That is
//! the C2-F1 blocker this test guards: the pem must verify against the embedded
//! key at build time, and this test pins the current repo state (dev-signed).

use std::path::Path;

fn test_payload() -> keygen::LicensePayload {
    keygen::LicensePayload {
        license_id: "free-test".into(),
        name: "Free Distribution".into(),
        email: "free@lit.solar".into(),
        issued_at: 1700000000,
        license_type: "free_distribution".into(),
        expires_at: None,
        source: keygen::LicenseSource::Direct,
    }
}

// --- mirror of build.rs (keep in sync, enforced by release.bats) -----------

// SYNC:begin:verify_free_distribution_pem
fn verify_free_distribution_pem(pem: &str, vk_bytes: &[u8; 32]) -> Result<(), String> {
    use base64::Engine;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    let trimmed = pem.trim();
    let inner = trimmed
        .strip_prefix("-----BEGIN LICENSE KEY-----")
        .and_then(|s| s.strip_suffix("-----END LICENSE KEY-----"))
        .ok_or("invalid license key envelope")?;
    let body: String = inner.lines().map(str::trim).collect();
    let (payload_b64, sig_b64) = body.split_once('.').ok_or("missing dot separator")?;
    if payload_b64.is_empty() || sig_b64.is_empty() {
        return Err("empty payload or signature".into());
    }
    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(sig_b64)
        .map_err(|e| format!("bad signature base64: {e}"))?;
    let sig = Signature::from_slice(&sig_bytes).map_err(|_| "invalid signature length")?;
    let vk =
        VerifyingKey::from_bytes(vk_bytes).map_err(|e| format!("bad verifying key bytes: {e}"))?;
    vk.verify(payload_b64.as_bytes(), &sig)
        .map_err(|e| format!("signature verification failed: {e}"))
}
// SYNC:end:verify_free_distribution_pem

// ---------------------------------------------------------------------------

#[test]
fn pem_signed_with_key_k_verifies_against_k_verifying_bytes() {
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;

    let sk = SigningKey::generate(&mut OsRng);
    let pem = keygen::sign_license_pem(&test_payload(), &sk);
    let vk_bytes = sk.verifying_key().to_bytes();
    assert!(
        verify_free_distribution_pem(&pem, &vk_bytes).is_ok(),
        "a pem signed with key K must verify against K's verifying key bytes"
    );
}

#[test]
fn pem_signed_with_key_k_fails_against_another_keys_bytes() {
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;

    let sk1 = SigningKey::generate(&mut OsRng);
    let sk2 = SigningKey::generate(&mut OsRng);
    let pem = keygen::sign_license_pem(&test_payload(), &sk1);
    let other = sk2.verifying_key().to_bytes();
    let err = verify_free_distribution_pem(&pem, &other).unwrap_err();
    assert!(
        err.contains("verif"),
        "expected a verification failure, got: {err}"
    );
}

#[test]
fn garbage_and_truncated_pems_fail() {
    // Not a license-key envelope at all.
    assert!(verify_free_distribution_pem("garbage", &[0u8; 32]).is_err());
    // No dot separator between payload and signature.
    let no_dot = "-----BEGIN LICENSE KEY-----\nbm90aGluZw==\n-----END LICENSE KEY-----";
    assert!(verify_free_distribution_pem(no_dot, &[0u8; 32]).is_err());
    // Bad signature base64.
    let bad_b64 = "-----BEGIN LICENSE KEY-----\ncGF5bG9hZA==.!@#$\n-----END LICENSE KEY-----";
    assert!(verify_free_distribution_pem(bad_b64, &[0u8; 32]).is_err());
    // Valid base64 but wrong-length signature (4 bytes, not 64).
    let short_sig = "-----BEGIN LICENSE KEY-----\ncGF5bG9hZA==.YWJjZA==\n-----END LICENSE KEY-----";
    assert!(verify_free_distribution_pem(short_sig, &[0u8; 32]).is_err());
    // A validly-signed pem must still fail against the all-zero key.
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;
    let sk = SigningKey::generate(&mut OsRng);
    let pem = keygen::sign_license_pem(&test_payload(), &sk);
    assert!(verify_free_distribution_pem(&pem, &[0u8; 32]).is_err());
}

/// Pins the current repo state: the committed `free_distribution.pem` is
/// dev-signed and must verify against `dev_license_verifying.bin` (the key
/// debug builds embed). The moment the pem is regenerated with a non-dev key
/// (e.g. the prod key, which release builds embed via LIT_LICENSE_VERIFYING_KEY_B64),
/// this test goes RED - exactly the fail-fast signal wanted.
#[test]
fn real_committed_free_pem_verifies_against_dev_verifying_key() {
    let keys_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("keys");
    let pem_path = keys_dir.join("free_distribution.pem");
    let vk_path = keys_dir.join("dev_license_verifying.bin");

    if !pem_path.exists() || !vk_path.exists() {
        eprintln!(
            "Skipping real_committed_free_pem_verifies_against_dev_verifying_key: key files not found"
        );
        return;
    }

    let pem = std::fs::read_to_string(&pem_path).unwrap();
    let vk_bytes: [u8; 32] = std::fs::read(&vk_path).unwrap().try_into().unwrap();
    assert!(
        verify_free_distribution_pem(&pem, &vk_bytes).is_ok(),
        "committed free_distribution.pem must verify against dev_license_verifying.bin; \
         if the pem was regenerated with a non-dev key this test fails, which is the desired fail-fast"
    );
}
