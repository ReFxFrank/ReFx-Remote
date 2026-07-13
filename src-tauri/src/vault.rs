//! Secret persistence. Production backend is Windows Credential Manager via
//! `keyring`; tests use an in-memory backend so they never touch the real
//! credential store. The only secret we persist is the rotating refresh
//! token — access tokens live in memory, and nothing here is logged or sent
//! over IPC.

use std::sync::Mutex;

use keyring::Entry;

use crate::panel::error::PanelError;

const SERVICE: &str = "gg.refx.desktop";
const REFRESH_KEY: &str = "panel_refresh_token";

enum Backend {
    Keyring,
    Memory(Mutex<Option<String>>),
    /// Test-only: every write/clear fails, reads say empty — models a
    /// broken Credential Manager so tests can prove the session survives.
    Broken,
}

pub struct Vault {
    backend: Backend,
}

impl Vault {
    pub fn keyring() -> Self {
        Self {
            backend: Backend::Keyring,
        }
    }

    pub fn in_memory() -> Self {
        Self {
            backend: Backend::Memory(Mutex::new(None)),
        }
    }

    pub fn broken() -> Self {
        Self {
            backend: Backend::Broken,
        }
    }

    fn entry() -> Result<Entry, PanelError> {
        Entry::new(SERVICE, REFRESH_KEY).map_err(|e| PanelError::Vault(e.to_string()))
    }

    pub fn store_refresh_token(&self, token: &str) -> Result<(), PanelError> {
        match &self.backend {
            Backend::Keyring => Self::entry()?
                .set_password(token)
                .map_err(|e| PanelError::Vault(e.to_string())),
            Backend::Memory(slot) => {
                *slot.lock().expect("vault lock") = Some(token.to_string());
                Ok(())
            }
            Backend::Broken => Err(PanelError::Vault("credential store unavailable".into())),
        }
    }

    pub fn load_refresh_token(&self) -> Result<Option<String>, PanelError> {
        match &self.backend {
            Backend::Keyring => match Self::entry()?.get_password() {
                Ok(t) => Ok(Some(t)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(PanelError::Vault(e.to_string())),
            },
            Backend::Memory(slot) => Ok(slot.lock().expect("vault lock").clone()),
            Backend::Broken => Ok(None),
        }
    }

    pub fn clear(&self) -> Result<(), PanelError> {
        match &self.backend {
            Backend::Keyring => match Self::entry()?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(PanelError::Vault(e.to_string())),
            },
            Backend::Memory(slot) => {
                *slot.lock().expect("vault lock") = None;
                Ok(())
            }
            Backend::Broken => Err(PanelError::Vault("credential store unavailable".into())),
        }
    }
}
