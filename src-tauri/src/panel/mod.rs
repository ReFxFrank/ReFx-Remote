//! Typed client for the ReFx panel REST API (`https://api.refx.gg/api/v1`).
//!
//! Contract: `docs/api-surface.md`. Envelope is `{ success, data }` with a
//! flat error shape; auth is a Bearer access JWT with single-flight rotating
//! refresh (reuse outside the 60s grace window revokes ALL user sessions).
//! Built in Phase 1.
