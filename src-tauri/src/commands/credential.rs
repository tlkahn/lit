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
const DEFAULT_PASSPHRASE: &str = "lit.app";

struct UnlockedState {
    derived_key: [u8; 32],
    salt: [u8; 16],
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
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
        self.state.lock().map(|guard| guard.is_some()).unwrap_or(false)
    }

    /// Initialize a new encrypted store with the given passphrase.
    /// Fails if the file already exists.
    pub fn init(&self, passphrase: &str) -> Result<(), String> {
        let mut guard = self.state.lock().map_err(|e| e.to_string())?;
        if self.file_exists() {
            return Err("Secret store already exists".into());
        }
        let salt = Self::random_salt();
        let derived_key = self.derive_key(passphrase, &salt)?;
        let entries: HashMap<String, String> = HashMap::new();
        self.write_encrypted_file(&derived_key, &salt, &entries, self.m_cost, self.t_cost, self.p_cost)?;
        *guard = Some(UnlockedState {
            derived_key,
            salt,
            m_cost: self.m_cost,
            t_cost: self.t_cost,
            p_cost: self.p_cost,
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
            salt,
            m_cost: file_m_cost,
            t_cost: file_t_cost,
            p_cost: file_p_cost,
            entries,
        });
        Ok(())
    }

    /// Lock the store, clearing in-memory secrets.
    #[cfg(test)]
    pub fn lock(&self) -> Result<(), String> {
        let mut guard = self.state.lock().map_err(|e| e.to_string())?;
        *guard = None;
        Ok(())
    }

    /// Try to unlock the store with the default passphrase, or create it if
    /// no file exists. Returns `Ok(true)` on success, `Ok(false)` when the
    /// file exists but was encrypted with a different passphrase (needs migration).
    pub fn auto_unlock(&self) -> Result<bool, String> {
        if self.is_unlocked() {
            return Ok(true);
        }
        if !self.file_exists() {
            self.init(DEFAULT_PASSPHRASE)?;
            return Ok(true);
        }
        match self.unlock(DEFAULT_PASSPHRASE) {
            Ok(()) => Ok(true),
            Err(e) if e.contains("wrong passphrase") || e.contains("Decryption failed") => Ok(false),
            Err(e) => Err(e),
        }
    }

    /// Migrate an existing store from `old_passphrase` to the default passphrase.
    ///
    /// `unlock` already proves the old passphrase is correct (decryption
    /// succeeds), so re-encryption uses the already-unlocked in-memory state
    /// directly instead of re-deriving and re-verifying the old passphrase.
    pub fn migrate(&self, old_passphrase: &str) -> Result<(), String> {
        self.unlock(old_passphrase)?;
        self.re_encrypt_unlocked(DEFAULT_PASSPHRASE)
    }

    /// Re-encrypt the already-unlocked store under `new_passphrase`.
    ///
    /// Holds the mutex for the entire operation to prevent concurrent `set()`
    /// or `delete()` calls from being silently lost.
    fn re_encrypt_unlocked(&self, new_passphrase: &str) -> Result<(), String> {
        let mut guard = self.state.lock().map_err(|e| e.to_string())?;
        let entries = guard
            .as_ref()
            .ok_or_else(|| "Store is locked".to_string())?
            .entries
            .clone();

        let new_salt = Self::random_salt();
        let new_key = self.derive_key(new_passphrase, &new_salt)?;
        self.write_encrypted_file(&new_key, &new_salt, &entries, self.m_cost, self.t_cost, self.p_cost)?;

        *guard = Some(UnlockedState {
            derived_key: new_key,
            salt: new_salt,
            m_cost: self.m_cost,
            t_cost: self.t_cost,
            p_cost: self.p_cost,
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
        m_cost: u32,
        t_cost: u32,
        p_cost: u32,
    ) -> Result<(), String> {
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);

        let ciphertext = Self::encrypt_payload(key, &nonce_bytes, entries)?;

        // Build the file content
        let mut data = Vec::new();
        data.extend_from_slice(MAGIC);
        data.extend_from_slice(&m_cost.to_be_bytes());
        data.extend_from_slice(&t_cost.to_be_bytes());
        data.extend_from_slice(&p_cost.to_be_bytes());
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
        self.write_encrypted_file(&state.derived_key, &state.salt, &state.entries, state.m_cost, state.t_cost, state.p_cost)
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

/// Check whether `provider` (hyphenated slug) matches a search provider from
/// `legal_provider_info()` that requires an API key.  Normalises hyphens to
/// underscores so credential slugs ("google-books") match PROVIDER_INFO ids
/// ("google_books").
fn is_search_provider_needing_key(provider: &str) -> bool {
    let normalised = provider.replace('-', "_");
    crate::bib::research_hub::legal_provider_info()
        .iter()
        .any(|p| p.id == normalised && p.needs_api_key)
}

fn account_for_provider(provider: &str) -> Result<String, String> {
    match provider {
        "openai" => Ok(ACCOUNT_OPENAI.to_string()),
        "anthropic" => Ok(ACCOUNT_ANTHROPIC.to_string()),
        // Any search provider from legal_provider_info() that needs an API key
        // is resolved dynamically -- adding a provider to PROVIDER_INFO with
        // needs_api_key: true is sufficient, no edit here required.
        _ if is_search_provider_needing_key(provider) => Ok(format!("{}-api-key", provider)),
        // Any LLM-registry-known provider or a custom-* slug derives its account
        // from the id directly.
        _ if crate::provider_registry::lookup(provider).is_some()
            || provider.starts_with("custom-") =>
        {
            Ok(format!("{}-api-key", provider))
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

fn set_api_key_inner(store: &dyn CredentialStore, provider: &str, key: &str) -> Result<(), String> {
    let account = account_for_provider(provider)?;
    store.set(SERVICE_NAME, &account, key)
}

pub(crate) fn get_api_key_inner(store: &dyn CredentialStore, provider: &str) -> Result<String, String> {
    let account = account_for_provider(provider)?;
    store.get(SERVICE_NAME, &account)
}

fn has_api_key_inner(store: &dyn CredentialStore, provider: &str) -> Result<bool, String> {
    let account = account_for_provider(provider)?;
    Ok(store.has(SERVICE_NAME, &account))
}

fn delete_api_key_inner(store: &dyn CredentialStore, provider: &str) -> Result<(), String> {
    let account = account_for_provider(provider)?;
    store.delete(SERVICE_NAME, &account)
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
pub fn auto_unlock_secret_store(
    store: tauri::State<'_, std::sync::Arc<EncryptedFileStore>>,
) -> Result<bool, String> {
    store.auto_unlock()
}

#[tauri::command]
pub fn migrate_secret_store(
    old_passphrase: String,
    store: tauri::State<'_, std::sync::Arc<EncryptedFileStore>>,
) -> Result<(), String> {
    store.migrate(&old_passphrase)
}

#[tauri::command]
pub fn secret_store_status(
    store: tauri::State<'_, std::sync::Arc<EncryptedFileStore>>,
) -> SecretStoreStatus {
    let exists = store.file_exists();
    let unlocked = store.is_unlocked();
    SecretStoreStatus { exists, unlocked }
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

    #[test]
    fn test_account_for_openrouter() {
        assert_eq!(account_for_provider("openrouter"), Ok("openrouter-api-key".to_string()));
    }

    #[test]
    fn test_account_for_groq() {
        assert_eq!(account_for_provider("groq"), Ok("groq-api-key".to_string()));
    }

    #[test]
    fn test_account_for_deepseek() {
        assert_eq!(account_for_provider("deepseek"), Ok("deepseek-api-key".to_string()));
    }

    #[test]
    fn test_account_for_ollama() {
        assert_eq!(account_for_provider("ollama"), Ok("ollama-api-key".to_string()));
    }

    #[test]
    fn test_account_for_gemini() {
        assert_eq!(account_for_provider("gemini"), Ok("gemini-api-key".to_string()));
    }

    #[test]
    fn test_account_for_mistral() {
        assert_eq!(account_for_provider("mistral"), Ok("mistral-api-key".to_string()));
    }

    #[test]
    fn test_account_for_together() {
        assert_eq!(account_for_provider("together"), Ok("together-api-key".to_string()));
    }

    #[test]
    fn test_account_for_every_registry_provider() {
        // The credential account mapping must be registry-driven: every provider
        // the registry knows about resolves to an account, with openai/anthropic
        // mapping to their distinct constants and all others to "{id}-api-key".
        // This fails if a registry provider lacks coverage in account_for_provider,
        // catching the silent "Unknown provider" regression when a new provider is
        // added to REGISTRY without a corresponding match arm.
        for id in crate::provider_registry::ids() {
            let expected = match id {
                "openai" => ACCOUNT_OPENAI.to_string(),
                "anthropic" => ACCOUNT_ANTHROPIC.to_string(),
                _ => format!("{}-api-key", id),
            };
            assert_eq!(
                account_for_provider(id),
                Ok(expected),
                "provider {id} must resolve to a credential account"
            );
        }
        assert_eq!(account_for_provider("openai"), Ok(ACCOUNT_OPENAI.to_string()));
        assert_eq!(
            account_for_provider("anthropic"),
            Ok(ACCOUNT_ANTHROPIC.to_string())
        );
    }

    #[test]
    fn test_account_for_custom_provider() {
        assert_eq!(
            account_for_provider("custom-my-vllm"),
            Ok("custom-my-vllm-api-key".to_string())
        );
    }

    #[test]
    fn test_account_for_custom_provider_arbitrary_slug() {
        assert_eq!(
            account_for_provider("custom-corp-proxy-2"),
            Ok("custom-corp-proxy-2-api-key".to_string())
        );
    }

    #[test]
    fn test_custom_provider_credential_cycle() {
        let store = InMemoryStore::new();
        set_api_key_inner(&store, "custom-my-vllm", "sk-custom").unwrap();
        assert_eq!(get_api_key_inner(&store, "custom-my-vllm").unwrap(), "sk-custom");
        assert_eq!(has_api_key_inner(&store, "custom-my-vllm").unwrap(), true);
        delete_api_key_inner(&store, "custom-my-vllm").unwrap();
        assert_eq!(has_api_key_inner(&store, "custom-my-vllm").unwrap(), false);
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

        store.lock().unwrap();
        assert!(!store.is_unlocked());

        store.unlock("passphrase").unwrap();
        assert!(store.is_unlocked());
    }

    #[test]
    fn test_wrong_passphrase_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("correct-passphrase").unwrap();
        store.lock().unwrap();

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
        store.lock().unwrap();

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

        store.lock().unwrap();
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
        store.lock().unwrap();

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
        store.lock().unwrap();

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
        store.lock().unwrap();

        let file_path = dir.path().join("secrets.enc");
        std::fs::write(&file_path, b"LIT\x01short").unwrap();

        let result = store.unlock("passphrase");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too short"));
    }

    #[test]
    fn test_migrate_preserves_data_and_switches_passphrase() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("old-pass").unwrap();
        store.set("svc", "acct", "secret").unwrap();

        store.lock().unwrap();
        store.migrate("old-pass").unwrap();

        assert!(store.is_unlocked());
        assert_eq!(store.get("svc", "acct").unwrap(), "secret");

        // Lock and verify old passphrase fails
        store.lock().unwrap();
        assert!(store.unlock("old-pass").is_err());

        // Default passphrase works
        store.unlock(DEFAULT_PASSPHRASE).unwrap();
        assert_eq!(store.get("svc", "acct").unwrap(), "secret");
    }

    // --- auto_unlock and migrate tests ---

    #[test]
    fn test_auto_unlock_creates_store_when_no_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        assert!(!store.file_exists());

        let result = store.auto_unlock().unwrap();
        assert!(result, "auto_unlock should return true when creating a new store");
        assert!(store.file_exists());
        assert!(store.is_unlocked());
    }

    #[test]
    fn test_auto_unlock_succeeds_with_default_passphrase() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init(DEFAULT_PASSPHRASE).unwrap();
        store.lock().unwrap();

        let result = store.auto_unlock().unwrap();
        assert!(result, "auto_unlock should return true for default passphrase");
        assert!(store.is_unlocked());
    }

    #[test]
    fn test_auto_unlock_returns_false_for_custom_passphrase() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("custom-passphrase").unwrap();
        store.lock().unwrap();

        let result = store.auto_unlock().unwrap();
        assert!(!result, "auto_unlock should return false for custom passphrase");
        assert!(!store.is_unlocked());
    }

    #[test]
    fn test_auto_unlock_noop_when_already_unlocked() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("passphrase").unwrap();
        assert!(store.is_unlocked());

        let result = store.auto_unlock().unwrap();
        assert!(result, "auto_unlock should return true when already unlocked");
    }

    #[test]
    fn test_migrate_from_custom_to_default() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("custom-old-pass").unwrap();
        store.set("svc", "acct", "secret").unwrap();
        store.lock().unwrap();

        store.migrate("custom-old-pass").unwrap();

        assert!(store.is_unlocked());
        assert_eq!(store.get("svc", "acct").unwrap(), "secret");

        // Verify default passphrase now works
        store.lock().unwrap();
        store.unlock(DEFAULT_PASSPHRASE).unwrap();
        assert_eq!(store.get("svc", "acct").unwrap(), "secret");

        // Old passphrase should fail
        store.lock().unwrap();
        assert!(store.unlock("custom-old-pass").is_err());
    }

    #[test]
    fn test_migrate_wrong_old_passphrase() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("correct-pass").unwrap();
        store.lock().unwrap();

        let result = store.migrate("wrong-pass");
        assert!(result.is_err());
    }

    #[test]
    fn test_auto_unlock_after_migrate() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("custom-pass").unwrap();
        store.set("svc", "key", "val").unwrap();
        store.lock().unwrap();

        // auto_unlock fails (custom passphrase)
        assert!(!store.auto_unlock().unwrap());

        // Migrate to default
        store.migrate("custom-pass").unwrap();
        store.lock().unwrap();

        // Now auto_unlock succeeds
        assert!(store.auto_unlock().unwrap());
        assert_eq!(store.get("svc", "key").unwrap(), "val");
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
    fn test_persist_after_file_deletion_does_not_corrupt_salt() {
        // This test verifies that if the encrypted file is externally deleted
        // between unlock() and a subsequent set(), the store either:
        //   (a) still writes the correct salt so data can be recovered, or
        //   (b) returns an error rather than silently writing a mismatched salt.
        // On the buggy code, persist() generates a fresh random salt when the
        // file is missing, but encrypts with the old derived_key. This makes
        // the data permanently unrecoverable on the next unlock().
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("passphrase").unwrap();

        // Store an initial credential so there is data to lose
        store.set("svc", "acct", "original-secret").unwrap();

        // Simulate external deletion of the encrypted file
        let file_path = dir.path().join("secrets.enc");
        std::fs::remove_file(&file_path).unwrap();

        // Now set a new credential -- on the buggy code this silently
        // writes with a mismatched salt, causing permanent data loss.
        // After the fix, this should either succeed with the cached salt,
        // or return an error. Either way, it must NOT silently corrupt.
        let set_result = store.set("svc", "acct2", "new-secret");

        // The set should succeed (file gets re-created with the cached salt)
        assert!(set_result.is_ok(), "set() should succeed using cached salt even if file was deleted");

        // Now lock and re-unlock to verify the data is actually recoverable
        store.lock().unwrap();
        store.unlock("passphrase").unwrap();

        // Both the old credential and the new one should be present
        assert_eq!(store.get("svc", "acct").unwrap(), "original-secret");
        assert_eq!(store.get("svc", "acct2").unwrap(), "new-secret");
    }

    #[test]
    fn test_delete_after_file_deletion_does_not_corrupt_salt() {
        // Same scenario but triggered via delete() instead of set()
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("passphrase").unwrap();
        store.set("svc", "acct1", "val1").unwrap();
        store.set("svc", "acct2", "val2").unwrap();

        // Delete the underlying file
        let file_path = dir.path().join("secrets.enc");
        std::fs::remove_file(&file_path).unwrap();

        // Delete a credential (triggers persist)
        let del_result = store.delete("svc", "acct1");
        assert!(del_result.is_ok(), "delete() should succeed using cached salt");

        // Lock and unlock -- must still be able to decrypt
        store.lock().unwrap();
        store.unlock("passphrase").unwrap();
        assert!(!store.has("svc", "acct1"));
        assert_eq!(store.get("svc", "acct2").unwrap(), "val2");
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

    #[test]
    fn test_lock_returns_error_on_poisoned_mutex() {
        use std::sync::Arc;
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(test_store(dir.path()));
        store.init("passphrase").unwrap();

        // Poison the mutex by panicking while holding the lock
        let store_clone = Arc::clone(&store);
        let handle = std::thread::spawn(move || {
            let _guard = store_clone.state.lock().unwrap();
            panic!("intentional panic to poison mutex");
        });
        // The thread panicked; join returns Err but the mutex is now poisoned
        let _ = handle.join();

        // lock() should return Err, not panic
        let result = store.lock();
        assert!(result.is_err(), "lock() should return Err on poisoned mutex, not panic");
    }

    #[test]
    fn test_is_unlocked_returns_false_on_poisoned_mutex() {
        use std::sync::Arc;
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(test_store(dir.path()));
        store.init("passphrase").unwrap();
        assert!(store.is_unlocked());

        // Poison the mutex
        let store_clone = Arc::clone(&store);
        let handle = std::thread::spawn(move || {
            let _guard = store_clone.state.lock().unwrap();
            panic!("intentional panic to poison mutex");
        });
        let _ = handle.join();

        // is_unlocked() should return false, not panic
        assert!(!store.is_unlocked(), "is_unlocked() should return false on poisoned mutex, not panic");
    }

    #[test]
    fn test_persist_uses_file_params_not_struct_defaults() {
        // Scenario: file was created with params A, but a new store instance
        // has different struct params B. After unlock + set (persist), the file
        // header must still reflect params A (the params used to derive the key),
        // not B (the struct defaults). Otherwise the next unlock will fail.
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("secrets.enc");

        // Step 1: Create store with params A = (256, 1, 1) and init
        let store_a = EncryptedFileStore::new_with_params(file_path.clone(), 256, 1, 1);
        store_a.init("test-passphrase").unwrap();
        store_a.set("svc", "key1", "value1").unwrap();
        store_a.lock().unwrap();

        // Step 2: Create a NEW store instance pointing to the same file
        // but with DIFFERENT params B = (512, 2, 1)
        let store_b = EncryptedFileStore::new_with_params(file_path.clone(), 512, 2, 1);

        // Step 3: Unlock with store_b. unlock() correctly reads params A from
        // the file and derives the key with params A.
        store_b.unlock("test-passphrase").unwrap();
        assert_eq!(store_b.get("svc", "key1").unwrap(), "value1");

        // Step 4: Set a new credential. This triggers persist() -> write_encrypted_file().
        // BUG: write_encrypted_file writes self.m_cost=512, self.t_cost=2 into the header,
        // but encrypts with a key derived from params A (256, 1, 1).
        store_b.set("svc", "key2", "value2").unwrap();

        // Step 5: Verify file header still has params A, not B
        let data = std::fs::read(&file_path).unwrap();
        let written_m_cost = u32::from_be_bytes(data[4..8].try_into().unwrap());
        let written_t_cost = u32::from_be_bytes(data[8..12].try_into().unwrap());
        let written_p_cost = u32::from_be_bytes(data[12..16].try_into().unwrap());
        assert_eq!(written_m_cost, 256, "File header m_cost must match the params used to derive the key (256), not the struct default (512)");
        assert_eq!(written_t_cost, 1, "File header t_cost must match the params used to derive the key (1), not the struct default (2)");
        assert_eq!(written_p_cost, 1, "File header p_cost must match the params used to derive the key");

        // Step 6: Lock and unlock again -- on the buggy code, this FAILS because
        // unlock reads params B=(512,2,1) from the header and derives a different key
        store_b.lock().unwrap();
        store_b.unlock("test-passphrase").expect(
            "Must be able to unlock after persist(); the file params must match the derived key params"
        );
        assert_eq!(store_b.get("svc", "key1").unwrap(), "value1");
        assert_eq!(store_b.get("svc", "key2").unwrap(), "value2");
    }

    #[test]
    fn test_delete_persist_uses_file_params_not_struct_defaults() {
        // Same bug but triggered via delete() instead of set()
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("secrets.enc");

        // Create with params A
        let store_a = EncryptedFileStore::new_with_params(file_path.clone(), 256, 1, 1);
        store_a.init("test-passphrase").unwrap();
        store_a.set("svc", "key1", "value1").unwrap();
        store_a.set("svc", "key2", "value2").unwrap();
        store_a.lock().unwrap();

        // Open with different params B
        let store_b = EncryptedFileStore::new_with_params(file_path.clone(), 512, 2, 1);
        store_b.unlock("test-passphrase").unwrap();

        // Delete triggers persist
        store_b.delete("svc", "key1").unwrap();

        // Lock and unlock must succeed
        store_b.lock().unwrap();
        store_b.unlock("test-passphrase").expect(
            "Must be able to unlock after delete-persist(); file params must match derived key params"
        );
        assert!(!store_b.has("svc", "key1"));
        assert_eq!(store_b.get("svc", "key2").unwrap(), "value2");
    }

    #[test]
    fn test_re_encrypt_unlocked_uses_in_memory_state() {
        // re_encrypt_unlocked must operate purely on the already-unlocked
        // in-memory state without re-deriving or re-verifying any old passphrase.
        // We prove it works without the file by deleting it while unlocked.
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("custom-old-pass").unwrap();
        store.set("svc", "acct", "secret").unwrap();
        assert!(store.is_unlocked());

        // Delete the underlying file to prove we don't read it.
        let file_path = dir.path().join("secrets.enc");
        std::fs::remove_file(&file_path).unwrap();
        assert!(!store.file_exists());

        // Re-encrypt to the default passphrase using only in-memory state.
        store
            .re_encrypt_unlocked(DEFAULT_PASSPHRASE)
            .expect("re_encrypt_unlocked should use in-memory state when unlocked");

        // The file is re-created and data preserved.
        assert!(store.file_exists());
        assert!(store.is_unlocked());
        assert_eq!(store.get("svc", "acct").unwrap(), "secret");

        // After lock, DEFAULT_PASSPHRASE unlocks; old passphrase does not.
        store.lock().unwrap();
        store.unlock(DEFAULT_PASSPHRASE).unwrap();
        assert_eq!(store.get("svc", "acct").unwrap(), "secret");
        store.lock().unwrap();
        assert!(store.unlock("custom-old-pass").is_err());
    }

    #[test]
    fn test_re_encrypt_unlocked_errors_when_locked() {
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(dir.path());
        store.init("pass").unwrap();
        store.lock().unwrap();
        assert!(!store.is_unlocked());

        let result = store.re_encrypt_unlocked(DEFAULT_PASSPHRASE);
        assert!(result.is_err());
    }

    #[test]
    fn test_re_encrypt_unlocked_does_not_lose_concurrent_set() {
        use std::sync::{Arc, Barrier};

        for round in 0..50 {
            let dir = tempfile::tempdir().unwrap();
            let store = Arc::new(test_store(dir.path()));
            store.init(DEFAULT_PASSPHRASE).unwrap();
            store.set("svc", "existing", "val").unwrap();

            let barrier = Arc::new(Barrier::new(2));

            let store_a = Arc::clone(&store);
            let barrier_a = Arc::clone(&barrier);
            let store_b = Arc::clone(&store);
            let barrier_b = Arc::clone(&barrier);

            std::thread::scope(|s| {
                s.spawn(move || {
                    barrier_a.wait();
                    store_a.re_encrypt_unlocked(DEFAULT_PASSPHRASE).unwrap();
                });
                s.spawn(move || {
                    barrier_b.wait();
                    std::thread::yield_now();
                    store_b.set("svc", "concurrent", "from-set").unwrap();
                });
            });

            assert!(
                store.has("svc", "concurrent"),
                "round {}: concurrent set() was lost by re_encrypt_unlocked",
                round
            );

            // Verify persistence: lock, unlock, check again
            store.lock().unwrap();
            store.unlock(DEFAULT_PASSPHRASE).unwrap();
            assert!(
                store.has("svc", "concurrent"),
                "round {}: concurrent set() lost on disk after re_encrypt_unlocked",
                round
            );
        }
    }

    #[test]
    fn test_concurrent_init_exactly_one_succeeds() {
        use std::sync::{Arc, Barrier};

        for _round in 0..5 {
            let dir = tempfile::tempdir().unwrap();
            let store = Arc::new(test_store(dir.path()));
            let barrier = Arc::new(Barrier::new(2));

            let store1 = Arc::clone(&store);
            let barrier1 = Arc::clone(&barrier);
            let store2 = Arc::clone(&store);
            let barrier2 = Arc::clone(&barrier);

            let (r1, r2) = std::thread::scope(|s| {
                let h1 = s.spawn(move || {
                    barrier1.wait();
                    store1.init("passphrase-A")
                });
                let h2 = s.spawn(move || {
                    barrier2.wait();
                    store2.init("passphrase-B")
                });
                (h1.join().unwrap(), h2.join().unwrap())
            });

            let ok_count = [&r1, &r2].iter().filter(|r| r.is_ok()).count();
            let err_count = [&r1, &r2].iter().filter(|r| r.is_err()).count();

            assert_eq!(
                ok_count, 1,
                "Exactly one init() must succeed, but got {} Ok and {} Err.\n  r1={:?}\n  r2={:?}",
                ok_count, err_count, r1, r2
            );
            assert_eq!(
                err_count, 1,
                "Exactly one init() must fail, but got {} Ok and {} Err.\n  r1={:?}\n  r2={:?}",
                ok_count, err_count, r1, r2
            );

            // Verify the store is in a consistent state: the winning passphrase
            // must be able to unlock the store after a lock/unlock cycle.
            store.lock().unwrap();

            let winner = if r1.is_ok() { "passphrase-A" } else { "passphrase-B" };
            store.unlock(winner).expect(
                "The winning passphrase must be able to unlock the store after lock/unlock cycle",
            );
            assert!(store.is_unlocked());
        }
    }

    #[test]
    fn test_search_providers_need_no_hardcoded_arms() {
        // Every search provider in legal_provider_info() that needs an API key
        // must resolve via is_search_provider_needing_key, so adding a provider
        // to PROVIDER_INFO with needs_api_key: true is sufficient -- no edit to
        // account_for_provider is required.
        for p in crate::bib::research_hub::legal_provider_info() {
            if !p.needs_api_key {
                continue;
            }
            // Credential slugs use hyphens; PROVIDER_INFO ids use underscores.
            let slug = p.id.replace('_', "-");
            assert_eq!(
                account_for_provider(&slug),
                Ok(format!("{}-api-key", slug)),
                "search provider {:?} (slug {:?}) must resolve dynamically",
                p.id, slug
            );
        }
    }

    #[test]
    fn test_is_search_provider_needing_key_positive() {
        assert!(super::is_search_provider_needing_key("semantic-scholar"));
        assert!(super::is_search_provider_needing_key("google-books"));
        assert!(super::is_search_provider_needing_key("core"));
        assert!(super::is_search_provider_needing_key("pubmed"));
        assert!(super::is_search_provider_needing_key("base"));
    }

    #[test]
    fn test_is_search_provider_needing_key_negative() {
        // Providers that exist but don't need a key
        assert!(!super::is_search_provider_needing_key("openalex"));
        assert!(!super::is_search_provider_needing_key("arxiv"));
        // Completely unknown provider
        assert!(!super::is_search_provider_needing_key("nonexistent"));
    }

    #[test]
    fn test_secret_store_status_serializes_only_exists_and_unlocked() {
        let status = SecretStoreStatus {
            exists: true,
            unlocked: false,
        };
        let value = serde_json::to_value(&status).unwrap();
        let obj = value.as_object().expect("status serializes to an object");
        assert!(obj.contains_key("exists"), "must contain exists");
        assert!(obj.contains_key("unlocked"), "must contain unlocked");
        assert!(
            !obj.contains_key("needs_migration"),
            "must not contain needs_migration"
        );
        assert_eq!(obj.len(), 2, "must have exactly exists and unlocked");
    }
}
