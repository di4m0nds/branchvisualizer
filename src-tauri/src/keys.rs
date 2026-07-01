// ─── Secure credential storage ───────────────────────────────────────────────
// Manually-entered provider API keys are stored in the OS keychain (Keychain on
// macOS, Credential Manager on Windows, Secret Service on Linux) rather than in
// plaintext localStorage. The frontend (src/lib/providerKeys.ts) prefers these
// on desktop and falls back to localStorage only in the browser build.

use keyring::Entry;

const SERVICE: &str = "code-agent";

fn entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, provider).map_err(|e| format!("keychain unavailable: {e}"))
}

/// Store (or, when `key` is empty, clear) a provider's API key.
#[tauri::command]
pub fn set_secure_key(provider: String, key: String) -> Result<(), String> {
    let e = entry(&provider)?;
    if key.is_empty() {
        return match e.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        };
    }
    e.set_password(&key).map_err(|err| err.to_string())
}

/// Retrieve a provider's stored API key, if any.
#[tauri::command]
pub fn get_secure_key(provider: String) -> Option<String> {
    entry(&provider).ok()?.get_password().ok()
}

/// Remove a provider's stored API key.
#[tauri::command]
pub fn delete_secure_key(provider: String) -> Result<(), String> {
    let e = entry(&provider)?;
    match e.delete_credential() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}
