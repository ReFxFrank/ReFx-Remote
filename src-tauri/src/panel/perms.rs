//! Admin RBAC permission matcher — a faithful mirror of the backend
//! `apps/panel-api/src/common/permissions.ts` `hasPermission` and the frontend
//! `src/lib/perms.ts`. Keep all three in lock-step; the test vectors below are
//! shared verbatim with the TS tests to prove parity.
//!
//! Authority for admin permissions is the SERVER (every `admin_*` route returns
//! 403 → `IpcError::Forbidden`); the frontend `perms.ts` copy gates the UI to
//! avoid dead-end 403s. The client-side guard against a UI bug firing an
//! unintended money action is the amount-binding check inside
//! `admin_user_credit_adjust` (`commands_admin.rs`), not a permission re-check —
//! this Rust matcher exists for parity verification and is available should a
//! command ever need a local permission gate.

pub const WILDCARD: &str = "*";

/// True if `perms` grants `required`. Hierarchy: `*` ⇒ all; exact; `<area>.*`;
/// `<area>.manage` ⇒ every granular action in that area (but "manage" is not
/// implied by anything narrower, and payments/roles are their own areas).
pub fn has_permission(perms: &[String], required: &str) -> bool {
    if perms.iter().any(|p| p == WILDCARD || p == required) {
        return true;
    }
    let area = required.split('.').next().unwrap_or("");
    let area_wildcard = format!("{area}.*");
    let area_manage = format!("{area}.manage");
    if perms.iter().any(|p| p == &area_wildcard) {
        return true;
    }
    if required != area_manage && perms.iter().any(|p| p == &area_manage) {
        return true;
    }
    false
}

/// A user is staff iff they hold any admin permission (the server's own test).
pub fn is_staff(perms: &[String]) -> bool {
    !perms.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn perms(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn wildcard_grants_everything() {
        let p = perms(&["*"]);
        assert!(has_permission(&p, "billing.refund"));
        assert!(has_permission(&p, "roles.manage"));
        assert!(has_permission(&p, "anything.at-all"));
    }

    #[test]
    fn exact_and_area_wildcard() {
        assert!(has_permission(&perms(&["users.read"]), "users.read"));
        assert!(has_permission(&perms(&["users.*"]), "users.suspend"));
        assert!(!has_permission(&perms(&["users.read"]), "users.suspend"));
    }

    #[test]
    fn manage_implies_granular_in_same_area_only() {
        let billing = perms(&["billing.manage"]);
        assert!(has_permission(&billing, "billing.refund")); // same area
        assert!(has_permission(&billing, "billing.read"));
        // payments + roles are their OWN areas — not implied by billing.manage.
        assert!(!has_permission(&billing, "payments.manage"));
        assert!(!has_permission(&billing, "roles.manage"));
    }

    #[test]
    fn manage_is_not_implied_by_narrower_grants() {
        // Holding a granular action must not grant the coarse manage.
        assert!(!has_permission(&perms(&["users.suspend"]), "users.manage"));
        assert!(!has_permission(&perms(&["billing.refund"]), "billing.manage"));
    }

    #[test]
    fn users_manage_implies_credit_and_password() {
        let p = perms(&["users.manage"]);
        assert!(has_permission(&p, "users.credit"));
        assert!(has_permission(&p, "users.password"));
        assert!(has_permission(&p, "users.delete"));
    }

    #[test]
    fn staff_test() {
        assert!(!is_staff(&perms(&[])));
        assert!(is_staff(&perms(&["support.read"])));
    }
}
