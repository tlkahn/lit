pub struct GeneratedKeypair {
    pub signing_seed: [u8; 32],
    pub verifying_bytes: [u8; 32],
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;
    use std::path::Path;

    fn generate_keypair() -> GeneratedKeypair {
        let sk = SigningKey::generate(&mut OsRng);
        GeneratedKeypair {
            signing_seed: sk.to_bytes(),
            verifying_bytes: sk.verifying_key().to_bytes(),
        }
    }

    fn write_dev_keys(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();

        let license = generate_keypair();
        std::fs::write(dir.join("dev_license_signing.bin"), license.signing_seed).unwrap();
        std::fs::write(dir.join("dev_license_verifying.bin"), license.verifying_bytes).unwrap();
    }

    #[test]
    fn generate_keypair_produces_32_byte_fields() {
        let kp = generate_keypair();
        assert_eq!(kp.signing_seed.len(), 32);
        assert_eq!(kp.verifying_bytes.len(), 32);
    }

    #[test]
    fn generate_keypair_verifying_derives_from_signing() {
        let kp = generate_keypair();
        let sk = SigningKey::from_bytes(&kp.signing_seed);
        assert_eq!(sk.verifying_key().to_bytes(), kp.verifying_bytes);
    }

    #[test]
    fn generate_keypair_different_each_call() {
        let a = generate_keypair();
        let b = generate_keypair();
        assert_ne!(a.signing_seed, b.signing_seed);
    }

    #[test]
    fn write_dev_keys_creates_files() {
        let dir = tempfile::tempdir().unwrap();
        write_dev_keys(dir.path());

        let lic_sign = std::fs::read(dir.path().join("dev_license_signing.bin")).unwrap();
        assert_eq!(lic_sign.len(), 32);

        let lic_ver = std::fs::read(dir.path().join("dev_license_verifying.bin")).unwrap();
        assert_eq!(lic_ver.len(), 32);

        assert!(
            !dir.path().join("dev_trial_signing.bin").exists(),
            "write_dev_keys must not create the removed trial signing key"
        );
    }

    #[test]
    fn write_dev_keys_verifying_matches_signing() {
        let dir = tempfile::tempdir().unwrap();
        write_dev_keys(dir.path());

        let seed: [u8; 32] = std::fs::read(dir.path().join("dev_license_signing.bin"))
            .unwrap()
            .try_into()
            .unwrap();
        let vk_bytes: [u8; 32] = std::fs::read(dir.path().join("dev_license_verifying.bin"))
            .unwrap()
            .try_into()
            .unwrap();

        let sk = SigningKey::from_bytes(&seed);
        assert_eq!(sk.verifying_key().to_bytes(), vk_bytes);
    }

    #[test]
    #[ignore]
    fn generate_dev_keys_to_repo() {
        let keys_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("keys");
        write_dev_keys(&keys_dir);
        println!("Dev keys written to {}", keys_dir.display());
    }
}
