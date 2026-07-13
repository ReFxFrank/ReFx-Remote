//! Typed client for the ReFx panel REST API (`https://api.refx.gg/api/v1`).
//!
//! Contract: `docs/api-surface.md`. Envelope is `{ success, data, meta? }`
//! with a flat error shape; auth is a Bearer access JWT with single-flight
//! rotating refresh (reuse outside the 60s grace window revokes ALL of the
//! user's sessions — see `auth.rs`).

pub mod auth;
pub mod client;
pub mod error;
pub mod models;
pub mod servers;
