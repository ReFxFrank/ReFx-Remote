//! Tracing pipeline with mandatory secret redaction.
//!
//! Every formatted log line passes through [`scrub`] before it reaches any
//! sink (file or stderr), so a token that accidentally lands in an error
//! string can't leak into logs or diagnostics bundles.

use std::io::{self, Write};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use regex::Regex;
use tracing_subscriber::fmt::MakeWriter;

/// Redaction patterns, in application order.
fn patterns() -> &'static [(Regex, &'static str)] {
    static PATTERNS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            // ReFx panel API keys: refx_<8-char-prefix><secret>, where both
            // parts are base64url — the alphabet includes `-` and `_`.
            (
                Regex::new(r"refx_[A-Za-z0-9_-]+").unwrap(),
                "refx_[REDACTED]",
            ),
            // JWTs (access/refresh/mfa tokens)
            (
                Regex::new(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+").unwrap(),
                "[JWT_REDACTED]",
            ),
            // Any bearer header that slips into an error chain
            (
                Regex::new(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+").unwrap(),
                "Bearer [REDACTED]",
            ),
        ]
    })
}

pub fn scrub(line: &str) -> String {
    let mut out = line.to_string();
    for (re, replacement) in patterns() {
        out = re.replace_all(&out, *replacement).into_owned();
    }
    out
}

/// Wraps any writer; scrubs each buffer before forwarding.
pub struct RedactingWriter<W: Write>(pub W);

impl<W: Write> Write for RedactingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let scrubbed = scrub(&String::from_utf8_lossy(buf));
        self.0.write_all(scrubbed.as_bytes())?;
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        self.0.flush()
    }
}

/// Log sink: redacted file (app log dir) + redacted stderr in debug builds.
struct Sink {
    file: &'static Mutex<std::fs::File>,
}

impl<'a> MakeWriter<'a> for Sink {
    type Writer = RedactingWriter<SinkWriter>;
    fn make_writer(&'a self) -> Self::Writer {
        RedactingWriter(SinkWriter { file: self.file })
    }
}

pub struct SinkWriter {
    file: &'static Mutex<std::fs::File>,
}

impl Write for SinkWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if let Ok(mut f) = self.file.lock() {
            f.write_all(buf)?;
        }
        #[cfg(debug_assertions)]
        io::stderr().write_all(buf)?;
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        if let Ok(mut f) = self.file.lock() {
            f.flush()?;
        }
        Ok(())
    }
}

/// Install the global subscriber. Called once from `setup`.
pub fn init(log_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(log_dir)?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("refx-desktop.log"))?;
    static FILE: OnceLock<Mutex<std::fs::File>> = OnceLock::new();
    let file = FILE.get_or_init(|| Mutex::new(file));

    // Bridge `log` records (tauri internals, plugins) into tracing.
    tracing_log::LogTracer::init()?;

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    let subscriber = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_ansi(false)
        .with_writer(Sink { file })
        .finish();
    tracing::subscriber::set_global_default(subscriber)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrubs_refx_api_keys() {
        let line = "failed with key refx_Ab12Cd34EFgh5678ijkl and moved on";
        let out = scrub(line);
        assert!(!out.contains("refx_Ab12Cd34EFgh5678ijkl"));
        assert!(out.contains("refx_[REDACTED]"));
    }

    #[test]
    fn scrubs_base64url_refx_keys_with_dash_and_underscore() {
        // Real keys are base64url: `-` and `_` appear routinely.
        let line = "key refx_a-B_c-D_12kJh-_9xY leaked";
        let out = scrub(line);
        assert!(!out.contains("refx_a-B_c-D_12kJh-_9xY"));
        assert!(out.contains("refx_[REDACTED] leaked"));
    }

    #[test]
    fn scrubs_jwts() {
        let line = "auth failed for eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.c2lnbmF0dXJl again";
        let out = scrub(line);
        assert!(!out.contains("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEifQ"));
        assert!(out.contains("[JWT_REDACTED]"));
    }

    #[test]
    fn scrubs_bearer_headers() {
        let out = scrub("request had Authorization: Bearer abc.def-ghi_jkl");
        assert!(!out.contains("abc.def-ghi_jkl"));
        assert!(out.contains("Bearer [REDACTED]"));
    }

    /// End-to-end: a tracing event containing secrets emits a redacted line.
    #[test]
    fn tracing_event_through_writer_is_redacted() {
        use std::sync::{Arc, Mutex};

        #[derive(Clone, Default)]
        struct Buf(Arc<Mutex<Vec<u8>>>);
        impl Write for Buf {
            fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(buf);
                Ok(buf.len())
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        impl<'a> MakeWriter<'a> for Buf {
            type Writer = RedactingWriter<Buf>;
            fn make_writer(&'a self) -> Self::Writer {
                RedactingWriter(self.clone())
            }
        }

        let buf = Buf::default();
        let subscriber = tracing_subscriber::fmt()
            .with_ansi(false)
            .with_writer(buf.clone())
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            tracing::info!(
                "login used refx_secretsecretsecret and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln"
            );
        });
        let out = String::from_utf8(buf.0.lock().unwrap().clone()).unwrap();
        assert!(out.contains("login used"), "event was logged: {out}");
        assert!(!out.contains("refx_secretsecretsecret"), "leaked key: {out}");
        assert!(!out.contains("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0"), "leaked jwt: {out}");
    }
}
