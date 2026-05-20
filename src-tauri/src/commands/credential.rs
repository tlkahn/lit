use std::collections::HashMap;
use std::sync::Mutex;

const SERVICE_NAME: &str = "com.lit.app";
const ACCOUNT_OPENAI: &str = "openai-api-key";
const ACCOUNT_ANTHROPIC: &str = "anthropic-api-key";

pub trait CredentialStore: Send + Sync {
    fn set(&self, service: &str, account: &str, password: &str) -> Result<(), String>;
    fn get(&self, service: &str, account: &str) -> Result<String, String>;
    fn has(&self, service: &str, account: &str) -> bool;
    fn delete(&self, service: &str, account: &str) -> Result<(), String>;
}

pub struct InMemoryStore {
    data: Mutex<HashMap<(String, String), String>>,
}

impl InMemoryStore {
    pub fn new() -> Self {
        Self {
            data: Mutex::new(HashMap::new()),
        }
    }
}

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

pub struct KeychainStore;

impl CredentialStore for KeychainStore {
    fn set(&self, service: &str, account: &str, password: &str) -> Result<(), String> {
        let output = std::process::Command::new("/usr/bin/security")
            .args(["add-generic-password", "-U", "-s", service, "-a", account, "-w", password])
            .output()
            .map_err(|e| format!("Failed to run security command: {}", e))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }

    fn get(&self, service: &str, account: &str) -> Result<String, String> {
        let output = std::process::Command::new("/usr/bin/security")
            .args(["find-generic-password", "-s", service, "-a", account, "-w"])
            .output()
            .map_err(|e| format!("Failed to run security command: {}", e))?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            Err(format!("No credential found for {}/{}", service, account))
        }
    }

    fn has(&self, service: &str, account: &str) -> bool {
        std::process::Command::new("/usr/bin/security")
            .args(["find-generic-password", "-s", service, "-a", account])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), String> {
        let output = std::process::Command::new("/usr/bin/security")
            .args(["delete-generic-password", "-s", service, "-a", account])
            .output()
            .map_err(|e| format!("Failed to run security command: {}", e))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
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

fn get_api_key_inner(store: &dyn CredentialStore, provider: &str) -> Result<String, String> {
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

    // --- TDD Cycle 1.2: KeychainStore trait bound ---

    #[test]
    fn test_keychain_store_trait_bound() {
        fn accepts_store(_: &dyn CredentialStore) {}
        let store = KeychainStore;
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
}
