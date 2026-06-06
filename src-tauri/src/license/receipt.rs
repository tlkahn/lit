//! App Store receipt validation.
//!
//! STUB: This module is only compiled under the `app-store` feature. The
//! current implementation always returns `None` — i.e. it never reports a
//! valid App Store entitlement. Real validation (PKCS#7/ASN.1 receipt parsing,
//! Apple root certificate chain verification, bundle-ID / app-version checks)
//! is tracked in issue #327.

use super::key::LicensePayload;

/// Validate the embedded App Store receipt and, if valid, return the
/// corresponding [`LicensePayload`].
///
/// STUB: always returns `None` until real PKCS#7/ASN.1 receipt validation is
/// implemented (tracked in issue #327). Returning `None` makes `get_status`
/// fall through to the existing local-key path, so behavior is unchanged.
pub fn validate_app_store_receipt() -> Option<LicensePayload> {
    // STUB: full PKCS#7/ASN.1 receipt parsing tracked in issue #327.
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_app_store_receipt_stub_returns_none() {
        assert!(validate_app_store_receipt().is_none());
    }
}
