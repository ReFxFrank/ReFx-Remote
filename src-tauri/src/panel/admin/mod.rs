//! Staff/admin domain of the panel API (`/api/v1/admin/*` and the admin-gated
//! routes on the shared controllers). Every function follows the same shape as
//! the customer-facing `panel::*` modules — `pub async fn f(auth, ...) -> Result<T, PanelError>`
//! over `AuthManager` helpers — and decodes permissively.
//!
//! Authorization is enforced server-side (a 403 surfaces as `IpcError::Forbidden`).
//! The frontend gates the UI on `profile.permissions` (see `src/lib/perms.ts`),
//! and money-moving commands re-check `panel::perms` in Rust as defense-in-depth.

pub mod billing;
pub mod nodes;
pub mod platform;
pub mod roles;
pub mod servers;
pub mod support;
pub mod users;
