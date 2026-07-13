//! SFTP transfers for files over the panel's 32 MiB upload cap.
//!
//! Credentials come from `GET /servers/:id/sftp` (+ one-time password via
//! `POST /servers/:id/sftp/rotate` — check password scoping before exposing
//! rotation in the UI; see docs/api-surface.md §8). Node port 2022.
//! Built in Phase 4.
