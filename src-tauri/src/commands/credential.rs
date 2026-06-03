use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::Argon2;
use rand::RngCore;
use serde::Serialize;

const SERVICE_NAME: &str = "com.lit.app";
const ACCOUNT_OPENAI: &str = "openai-api-key";
const ACCOUNT_ANTHROPIC: &str = "anthropic-api-key";

pub trait CredentialStore: Send + Sync {
    fn set(&self, service: &str, account: &str, password: &str) -> Result<(), String>;
    fn get(&self, service: &str, account: &str) -> Result<String, String>;
    fn has(&self, service: &str, account: &str) -> bool;
    fn delete(&self, service: &str, account: &str) -> Result<(), String>;
}

#[cfg(test)]
pub struct InMemoryStore {
    data: std::sync::Mutex<std::collections::HashMap<(String, String), String>>,
}

#[cfg(test)]
impl InMemoryStore {
    pub fn new() -> Self {
        Self {
            data: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }
}

#[cfg(test)]
impl CredentialStore for InMemoryStore {
    fn set(&self, service: &str, account: &str, password: &str) -> Result<(), String> {
        self.data
            .lock()
            .map_err(|e| e.to_string())?
            .insert((service.to_string(), account.to_string()), password.to_string());
        Ok(())
    }

    fn get(&self, service: &str, account: &str) -> Result<String, String> {
        self.data
            .lock()
            .map_err(|e| e.to_string())?
            .get(&(service.to_string(), account.to_string()))
            .cloned()
            .ok_or_else(|| format!("No credential found for {}/{}", service, account))
    }

    fn has(&self, service: &str, account: &str) -> bool {
        self.data
            .lock()
            .map(|d| d.contains_key(&(service.to_string(), account.to_string())))
            .unwrap_or(false)
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), String> {
        self.data
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&(service.to_string(), account.to_string()));
        Ok(())
    }
}

const MAGIC: &[u8; 4] = b"LIT\x01";
const DEFAULT_M_COST: u32 = 65536; // 64 MiB
const DEFAULT_T_COST: u32 = 3;
const DEFAULT_P_COST: u32 = 1;

struct UnlockedState {
    derived_key: [u8; 32],
    entries: HashMap<String, String>,
}

pub struct EncryptedFileStore {
    file_path: PathBuf,
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
    state: Mutex<Option<UnlockedState>>,
}

impl EncryptedFileStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            file_path: app_data_dir.join("secrets.enc"),
            m_cost: DEFAULT_M_COST,
            t_cost: DEFAULT_T_COST,
            p_cost: DEFAULT_P_COST,
            state: Mutex::new(None),
        }
    }

    #[cfg(test)]
    pub fn new_with_params(file_path: PathBuf, m_cost: u32, t_cost: u32, p_cost: u32) -> Self {
        Self {
            file_path,
            m_cost,
            t_cost,
            p_cost,
            state: Mutex::new(None),
        }
    }

    pub fn file_exists(&self) -> bool {
        self.file_path.exists()
    }

    pub fn is_unlocked(&self) -> bool {
        self.state.lock().unwrap().is_some()
    }

    /// Initialize a new encrypted store with the given passphrase.
    /// Fails if the file already exists.
    pub fn init(&self, passphrase: &str) -> Result<(), String> {
        if self.file_exists() {
            return Err("Secret store already exists".into());
        }
        let salt = Self::random_salt();
        let derived_key = self.derive_key(passphrase, &salt)?;
        let entries: HashMap<String, String> = HashMap::new();
        self.write_encrypted_file(&derived_key, &salt, &entries)?;
        let mut guard = self.state.lock().map_err(|e| e.to_string())?;
        *guard = Some(UnlockedState {
            derived_key,
            entries,
        });
        Ok(())
    }

    /// Unlock an existing store by decrypting the file with the given passphrase.
    pub fn unlock(&self, passphrase: &str) -> Result<(), String> {
        if !self.file_exists() {
            return Err("Secret store file does not exist".into());
        }
        let (salt, nonce, ciphertext, file_m_cost, file_t_cost, file_p_cost) =
            Self::read_encrypted_file(&self.file_path)?;
        let derived_key = Self::derive_key_with_params(passphrase, &salt, file_m_cost, file_t_cost, file_p_cost)?;
        let entries = Self::decrypt_payload(&derived_key, &nonce, &ciphertext)?;
        let mut guard = self.state.lock().map_err(|e| e.to_string())?;
        *guard = Some(UnlockedState {
            derived_key,
            entries,
        });
        Ok(())
    }

    /// Lock the store, clearing in-memory secrets.
    pub fn lock(&self) {
        let mut guard = self.state.lock().unwrap();
        *guard = None;
    }

    /// Change the passphrase. Requires the old passphrase for verification.
    pub fn change_passphrase(&self, old_passphrase: &str, new_passphrase: &str) -> Result<(), String> {
        // Verify old passphrase by decrypting
        if !self.file_exists() {
            return Err("Secret store file does not exist".into());
        }
        let (old_salt, old_nonce, old_ciphertext, file_m_cost, file_t_cost, file_p_cost) =
            Self::read_encrypted_file(&self.file_path)?;
        let old_key = Self::derive_key_with_params(old_passphrase, &old_salt, file_m_cost, file_t_cost, file_p_cost)?;
        let entries = Self::decrypt_payload(&old_key, &old_nonce, &old_ciphertext)?;

        // Re-encrypt with new passphrase and fresh salt
        let new_salt = Self::random_salt();
        let new_key = self.derive_key(new_passphrase, &new_salt)?;
        self.write_encrypted_file(&new_key, &new_salt, &entries)?;

        // Update in-memory state
        let mut guard = self.state.lock().map_err(|e| e.to_string())?;
        *guard = Some(UnlockedState {
            derived_key: new_key,
            entries,
        });
        Ok(())
    }

    // --- Private helpers ---

    fn derive_key(&self, passphrase: &str, salt: &[u8; 16]) -> Result<[u8; 32], String> {
        Self::derive_key_with_params(passphrase, salt, self.m_cost, self.t_cost, self.p_cost)
    }

    fn derive_key_with_params(
        passphrase: &str,
        salt: &[u8; 16],
        m_cost: u32,
        t_cost: u32,
        p_cost: u32,
    ) -> Result<[u8; 32], String> {
        let params = argon2::Params::new(m_cost, t_cost, p_cost, Some(32))
            .map_err(|e| format!("Invalid Argon2 params: {}", e))?;
        let argon2 = Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);
        let mut key = [0u8; 32];
        argon2
            .hash_password_into(passphrase.as_bytes(), salt, &mut key)
            .map_err(|e| format!("Key derivation failed: {}", e))?;
        Ok(key)
    }

    fn encrypt_payload(
        key: &[u8; 32],
        nonce: &[u8; 12],
        entries: &HashMap<String, String>,
    ) -> Result<Vec<u8>, String> {
        let plaintext = serde_json::to_vec(entries)
            .map_err(|e| format!("Failed to serialize entries: {}", e))?;
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| format!("Failed to create cipher: {}", e))?;
        let nonce = Nonce::from_slice(nonce);
        cipher
            .encrypt(nonce, plaintext.as_ref())
            .map_err(|e| format!("Encryption failed: {}", e))
    }

    fn decrypt_payload(
        key: &[u8; 32],
        nonce: &[u8; 12],
        ciphertext: &[u8],
    ) -> Result<HashMap<String, String>, String> {
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| format!("Failed to create cipher: {}", e))?;
        let nonce = Nonce::from_slice(nonce);
        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| "Decryption failed — wrong passphrase or corrupted file".to_string())?;
        serde_json::from_slice(&plaintext)
            .map_err(|e| format!("Failed to parse decrypted data: {}", e))
    }

    fn write_encrypted_file(
        &self,
        key: &[u8; 32],
        salt: &[u8; 16],
        entries: &HashMap<String, String>,
    ) -> Result<(), String> {
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);

        let ciphertext = Self::encrypt_payload(key, &nonce_bytes, entries)?;

        // Build the file content
        let mut data = Vec::new();
        data.extend_from_slice(MAGIC);
        data.extend_from_slice(&self.m_cost.to_be_bytes());
        data.extend_from_slice(&self.t_cost.to_be_bytes());
        data.extend_from_slice(&self.p_cost.to_be_bytes());
        data.extend_from_slice(salt);
        data.extend_from_slice(&nonce_bytes);
        data.extend_from_slice(&ciphertext);

        // Atomic write: write to temp file then rename
        let parent = self
            .file_path
            .parent()
            .ok_or_else(|| "Invalid file path: no parent directory".to_string())?;
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;

        let mut tmp_path = self.file_path.clone();
        tmp_path.set_extension("enc.tmp");

        let mut file = std::fs::File::create(&tmp_path)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;
        file.write_all(&data)
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to sync temp file: {}", e))?;
        drop(file);

        std::fs::rename(&tmp_path, &self.file_path)
            .map_err(|e| format!("Failed to rename temp file: {}", e))?;

        Ok(())
    }

    fn read_encrypted_file(
        path: &PathBuf,
    ) -> Result<([u8; 16], [u8; 12], Vec<u8>, u32, u32, u32), String> {
        let data = std::fs::read(path)
            .map_err(|e| format!("Failed to read encrypted file: {}", e))?;

        // Minimum size: 4 (magic) + 4*3 (params) + 16 (salt) + 12 (nonce) + 16 (min GCM tag) = 60
        if data.len() < 60 {
            return Err("Encrypted file is too short or corrupted".into());
        }

        if &data[0..4] != MAGIC {
            return Err("Invalid file format: bad magic bytes".into());
        }

        let m_cost = u32::from_be_bytes(data[4..8].try_into().unwrap());
        let t_cost = u32::from_be_bytes(data[8..12].try_into().unwrap());
        let p_cost = u32::from_be_bytes(data[12..16].try_into().unwrap());

        let mut salt = [0u8; 16];
        salt.copy_from_slice(&data[16..32]);

        let mut nonce = [0u8; 12];
        nonce.copy_from_slice(&data[32..44]);

        let ciphertext = data[44..].to_vec();

        Ok((salt, nonce, ciphertext, m_cost, t_cost, p_cost))
    }

    fn random_salt() -> [u8; 16] {
        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        salt
    }

    /// Persist current in-memory entries to disk. Called after set/delete.
    fn persist(&self, state: &UnlockedState) -> Result<(), String> {
        let salt_and_rest = Self::read_encrypted_file(&self.file_path);
        let salt = match salt_and_rest {
            Ok((salt, _, _, _, _, _)) => salt,
            Err(_) => Self::random_salt(),
        };
        self.write_encrypted_file(&state.derived_key, &salt, &state.entries)
    }
}

impl CredentialStore for EncryptedFileStore {
    fn set(&self, service: &str, account: &str, password: &str) -> Result<(), String> {
        let mut guard = self.state.lock().map_err(|e| e.to_string())?;
        let state = guard
            .as_mut()
            .ok_or_else(|| "Store is locked".to_string())?;
        let key = format!("{}:{}", service, account);
        state.entries.insert(key, password.to_string());
        self.persist(state)
    }

    fn get(&self, service: &str, account: &str) -> Result<String, String> {
        let guard = self.state.lock().map_err(|e| e.to_string())?;
        let state = guard
            .as_ref()
            .ok_or_else(|| "Store is locked".to_string())?;
        let key = format!("{}:{}", service, account);
        state
            .entries
            .get(&key)
            .cloned()
            .ok_or_else(|| format!("No credential found for {}/{}", service, account))
    }

    fn has(&self, service: &str, account: &str) -> bool {
        let guard = match self.state.lock() {
            Ok(g) => g,
            Err(_) => return false,
        };
        let state = match guard.as_ref() {
            Some(s) => s,
            None => return false, // locked
        };
        let key = format!("{}:{}", service, account);
        state.entries.contains_key(&key)
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), String> {
        let mut guard = self.state.lock().map_err(|e| e.to_string())?;
        let state = guard
            .as_mut()
            .ok_or_else(|| "Store is locked".to_string())?;
        let key = format!("{}:{}", service, account);
        state.entries.remove(&key);
        self.persist(state)
    }
}

fn account_for_provider(provider: &str) -> Result<&'static str, String> {
    match provider {
        "openai" => Ok(ACCOUNT_OPENAI),
        "anthropic" => Ok(ACCOUNT_ANTHROPIC),
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

fn set_api_key_inner(store: &dyn CredentialStore, provider: &str, key: &str) -> Result<(), String> {
    let account = account_for_provider(provider)?;
    store.set(SERVICE_NAME, account, key)
}

pub(crate) fn get_api_key_inner(store: &dyn CredentialStore, provider: &str) -> Result<String, String> {
    let account = account_for_provider(provider)?;
    store.get(SERVICE_NAME, account)
}

fn has_api_key_inner(store: &dyn CredentialStore, provider: &str) -> Result<bool, String> {
    let account = account_for_provider(provider)?;
    Ok(store.has(SERVICE_NAME, account))
}

fn delete_api_key_inner(store: &dyn CredentialStore, provider: &str) -> Result<(), String> {
    let account = account_for_provider(provider)?;
    store.delete(SERVICE_NAME, account)
}

#[tauri::command]
pub fn set_api_key(
    provider: String,
    key: String,
    store: tauri::State<'_, std::sync::Arc<dyn CredentialStore>>,
) -> Result<(), String> {
    set_api_key_inner(store.as_ref(), &provider, &key)
}

#[tauri::command]
pub fn get_api_key(
    provider: String,
    store: tauri::State<'_, std::sync::Arc<dyn CredentialStore>>,
) -> Result<String, String> {
    get_api_key_inner(store.as_ref(), &provider)
}

#[tauri::command]
pub fn has_api_key(
    provider: String,
    store: tauri::State<'_, std::sync::Arc<dyn CredentialStore>>,
) -> Result<bool, String> {
    has_api_key_inner(store.as_ref(), &provider)
}

#[tauri::command]
pub fn delete_api_key(
    provider: String,
    store: tauri::State<'_, std::sync::Arc<dyn CredentialStore>>,
) -> Result<(), String> {
    delete_api_key_inner(store.as_ref(), &provider)
}

#[derive(Debug, Clone, Serialize)]
pub struct SecretStoreStatus {
    pub exists: bool,
    pub unlocked: bool,
}

#[tauri::command]
pub fn init_secret_store(
    passphrase: String,
    store: tauri::State<'_, std::sync::Arc<EncryptedFileStore>>,
) -> Result<(), String> {
    store.init(&passphrase)
}

#[tauri::command]
pub fn unlock_secret_store(
    passphrase: String,
    store: tauri::State<'_, std::sync::Arc<EncryptedFileStore>>,
) -> Result<(), String> {
    store.unlock(&passphrase)
}

#[tauri::command]
pub fn lock_secret_store(
    store: tauri::State<'_, std::sync::Arc<EncryptedFileStore>>,
) -> Result<(), String> {
    store.lock();
    Ok(())
}

#[tauri::command]
pub fn secret_store_status(
    store: tauri::State<'_, std::sync::Arc<EncryptedFileStore>>,
) -> SecretStoreStatus {
    SecretStoreStatus {
        exists: store.file_exists(),
        unlocked: store.is_unlocked(),
    }
}

#[tauri::command]
pub fn change_secret_store_passphrase(
    old_passphrase: String,
    new_passphrase: String,
    store: tauri::State<'_, std::sync::Arc<EncryptedFileStore>>,
) -> Result<(), String> {
    store.change_passphrase(&old_passphrase, &new_passphrase)
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- TDD Cycle 1.1: InMemoryStore ---

    #[test]
    fn test_in_memory_set_and_get() {
        let store = InMemoryStore::new();
        store.set("svc", "acct", "secret123").unwrap();
        assert_eq!(store.get("svc", "acct").unwrap(), "secret123");
    }

    #[test]
    fn test_in_memory_has_false_when_absent() {
        let store = InMemoryStore::new();
        assert!(!store.has("svc", "acct"));
    }

    #[test]
    fn test_in_memory_has_true_when_present() {
        let store = InMemoryStore::new();
        store.set("svc", "acct", "pw").unwrap();
        assert!(store.has("svc", "acct"));
    }

    #[test]
    fn test_in_memory_delete() {
        let store = InMemoryStore::new();
        store.set("svc", "acct", "pw").unwrap();
        store.delete("svc", "acct").unwrap();
        assert!(!store.has("svc", "acct"));
    }

    #[test]
    fn test_in_memory_overwrite() {
        let store = InMemoryStore::new();
        store.set("svc", "acct", "first").unwrap();
        store.set("svc", "acct", "second").unwrap();
        assert_eq!(store.get("svc", "acct").unwrap(), "second");
    }

    // --- TDD Cycle 1.2: EncryptedFileStore trait bound ---

    #[test]
    fn test_encrypted_file_store_trait_bound() {
        fn accepts_store(_: &dyn CredentialStore) {}
        let dir = tempfile::tempdir().unwrap();
        let store = EncryptedFileStore::new_with_params(
            dir.path().join("secrets.enc"),
            256, 1, 1,
        );
        accepts_store(&store);
    }

    // --- TDD Cycle 1.3: Tauri commands (via inner functions) ---

    #[test]
    fn test_set_api_key_openai() {
        let store = InMemoryStore::new();
        set_api_key_inner(&store, "openai", "sk-test").unwrap();
        assert_eq!(store.get(SERVICE_NAME, ACCOUNT_OPENAI).unwrap(), "sk-test");
    }

    #[test]
    fn test_get_api_key_returns_stored_value() {
        let store = InMemoryStore::new();
        store.set(SERVICE_NAME, ACCOUNT_OPENAI, "sk-abc").unwrap();
        assert_eq!(get_api_key_inner(&store, "openai").unwrap(), "sk-abc");
    }

    #[test]
    fn test_has_api_key_false() {
        let store = InMemoryStore::new();
        assert_eq!(has_api_key_inner(&store, "openai").unwrap(), false);
    }

    #[test]
    fn test_has_api_key_true() {
        let store = InMemoryStore::new();
        store.set(SERVICE_NAME, ACCOUNT_ANTHROPIC, "key").unwrap();
        assert_eq!(has_api_key_inner(&store, "anthropic").unwrap(), true);
    }

    #[test]
    fn test_delete_api_key() {
        let store = InMemoryStore::new();
        set_api_key_inner(&store, "openai", "key").unwrap();
        delete_api_key_inner(&store, "openai").unwrap();
        assert_eq!(has_api_key_inner(&store, "openai").unwrap(), false);
    }

    #[test]
    fn test_invalid_provider_returns_error() {
        let store = InMemoryStore::new();
        assert!(set_api_key_inner(&store, "invalid", "key").is_err());
        assert!(get_api_key_inner(&store, "invalid").is_err());
        assert!(has_api_key_inner(&store, "invalid").is_err());
        assert!(delete_api_key_inner(&store, "invalid").is_err());
    }

    // --- EncryptedFileStore tests ---

    fn test_store(dir: &std::path::Path) -> EncryptedFileStore {
        EncryptedFileStore::new_with_params(
            dir.join("secrets.enc"),
            256, // m_cost: low for test speed
            1,   // t_cost
            1,   // p_cost
        )
    }

    #[test]
    fn test_init_creates_file_and_unlocks() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        assert!(!store.file_exists());
        assert!(!store.is_unlocked());

        store.init("my-passphrase").unwrap();

        assert!(store.file_exists());
        assert!(store.is_unlocked());
    }

    #[test]
    fn test_init_fails_if_file_exists() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("passphrase").unwrap();
        let result = store.init("passphrase");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn test_lock_and_unlock_cycle() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("passphrase").unwrap();
        assert!(store.is_unlocked());

        store.lock();
        assert!(!store.is_unlocked());

        store.unlock("passphrase").unwrap();
        assert!(store.is_unlocked());
    }

    #[test]
    fn test_wrong_passphrase_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("correct-passphrase").unwrap();
        store.lock();

        let result = store.unlock("wrong-passphrase");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("wrong passphrase"));
        assert!(!store.is_unlocked());
    }

    #[test]
    fn test_set_get_delete_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("passphrase").unwrap();

        store.set("svc", "acct", "secret123").unwrap();
        assert_eq!(store.get("svc", "acct").unwrap(), "secret123");
        assert!(store.has("svc", "acct"));

        store.delete("svc", "acct").unwrap();
        assert!(!store.has("svc", "acct"));
        assert!(store.get("svc", "acct").is_err());
    }

    #[test]
    fn test_credentials_locked_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("passphrase").unwrap();
        store.set("svc", "acct", "secret").unwrap();
        store.lock();

        assert!(store.set("svc", "acct2", "val").is_err());
        assert!(store.get("svc", "acct").is_err());
        assert!(!store.has("svc", "acct")); // returns false when locked
        assert!(store.delete("svc", "acct").is_err());
    }

    #[test]
    fn test_persistence_across_lock_unlock() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("passphrase").unwrap();

        store.set("svc", "acct1", "val1").unwrap();
        store.set("svc", "acct2", "val2").unwrap();

        store.lock();
        store.unlock("passphrase").unwrap();

        assert_eq!(store.get("svc", "acct1").unwrap(), "val1");
        assert_eq!(store.get("svc", "acct2").unwrap(), "val2");
    }

    #[test]
    fn test_persistence_across_instances() {
        let dir = tempfile::tempdir().unwrap();
        {
            let store = test_store(dir.path());
            store.init("passphrase").unwrap();
            store.set("svc", "key", "value123").unwrap();
        }
        // New instance, same file path
        {
            let store2 = test_store(dir.path());
            assert!(store2.file_exists());
            store2.unlock("passphrase").unwrap();
            assert_eq!(store2.get("svc", "key").unwrap(), "value123");
        }
    }

    #[test]
    fn test_corrupted_file_detected() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("passphrase").unwrap();
        store.lock();

        // Corrupt the file
        let file_path = dir.path().join("secrets.enc");
        let mut data = std::fs::read(&file_path).unwrap();
        // Flip some bytes in the ciphertext area
        if data.len() > 50 {
            data[50] ^= 0xFF;
            data[51] ^= 0xFF;
        }
        std::fs::write(&file_path, &data).unwrap();

        let result = store.unlock("passphrase");
        assert!(result.is_err());
    }

    #[test]
    fn test_corrupted_magic_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("passphrase").unwrap();
        store.lock();

        let file_path = dir.path().join("secrets.enc");
        let mut data = std::fs::read(&file_path).unwrap();
        data[0] = b'X'; // corrupt magic
        std::fs::write(&file_path, &data).unwrap();

        let result = store.unlock("passphrase");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("bad magic"));
    }

    #[test]
    fn test_truncated_file_detected() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("passphrase").unwrap();
        store.lock();

        let file_path = dir.path().join("secrets.enc");
        std::fs::write(&file_path, b"LIT\x01short").unwrap();

        let result = store.unlock("passphrase");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too short"));
    }

    #[test]
    fn test_change_passphrase() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("old-pass").unwrap();
        store.set("svc", "acct", "secret").unwrap();

        store.change_passphrase("old-pass", "new-pass").unwrap();

        // Should be unlocked with new key in memory
        assert!(store.is_unlocked());
        assert_eq!(store.get("svc", "acct").unwrap(), "secret");

        // Lock and verify old passphrase fails
        store.lock();
        assert!(store.unlock("old-pass").is_err());

        // New passphrase works
        store.unlock("new-pass").unwrap();
        assert_eq!(store.get("svc", "acct").unwrap(), "secret");
    }

    #[test]
    fn test_change_passphrase_wrong_old() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("correct").unwrap();

        let result = store.change_passphrase("wrong", "new");
        assert!(result.is_err());
    }

    #[test]
    fn test_unlock_nonexistent_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        let result = store.unlock("passphrase");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn test_set_overwrites_existing_key() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("passphrase").unwrap();

        store.set("svc", "acct", "first").unwrap();
        store.set("svc", "acct", "second").unwrap();
        assert_eq!(store.get("svc", "acct").unwrap(), "second");
    }

    #[test]
    fn test_api_key_operations_with_encrypted_store() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("passphrase").unwrap();

        set_api_key_inner(&store, "openai", "sk-test-key").unwrap();
        assert_eq!(get_api_key_inner(&store, "openai").unwrap(), "sk-test-key");
        assert!(has_api_key_inner(&store, "openai").unwrap());

        delete_api_key_inner(&store, "openai").unwrap();
        assert!(!has_api_key_inner(&store, "openai").unwrap());
    }

    #[test]
    fn test_file_format_structure() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("passphrase").unwrap();

        let file_path = dir.path().join("secrets.enc");
        let data = std::fs::read(&file_path).unwrap();

        // Check magic bytes
        assert_eq!(&data[0..4], b"LIT\x01");
        // Check m_cost = 256
        assert_eq!(u32::from_be_bytes(data[4..8].try_into().unwrap()), 256);
        // Check t_cost = 1
        assert_eq!(u32::from_be_bytes(data[8..12].try_into().unwrap()), 1);
        // Check p_cost = 1
        assert_eq!(u32::from_be_bytes(data[12..16].try_into().unwrap()), 1);
        // Total header: 4 + 12 + 16 + 12 = 44 bytes
        assert!(data.len() >= 60); // header + at least GCM tag
    }
}
