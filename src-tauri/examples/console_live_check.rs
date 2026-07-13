//! Phase 3 live verification: drive a real console session against the test
//! server and prove output/stats/status stream in. Uses an in-memory vault
//! (never touches the app's saved session) and a stdout sink.
//!
//! Usage:
//!   RFX_EMAIL=... RFX_PASS=... [RFX_SERVER_ID=...] [RFX_START=1] \
//!     cargo run --example console_live_check
//!
//! With RFX_START=1 it also issues a power `start` so you can watch boot
//! output arrive within ~1s. Prints no tokens.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use refx_desktop_lib::console::{spawn_session, ConsoleLine, ConsoleSink};
use refx_desktop_lib::panel::auth::{AuthManager, LoginOutcome};
use refx_desktop_lib::panel::client::PanelClient;
use refx_desktop_lib::panel::servers::{self, PowerSignal};
use refx_desktop_lib::vault::Vault;

struct StdoutSink {
    start: Instant,
    console_count: AtomicUsize,
    stats_count: AtomicUsize,
}

impl StdoutSink {
    fn ms(&self) -> u128 {
        self.start.elapsed().as_millis()
    }
}

impl ConsoleSink for StdoutSink {
    fn console(&self, _server_id: &str, line: &ConsoleLine) {
        let n = self.console_count.fetch_add(1, Ordering::Relaxed) + 1;
        if n <= 40 {
            println!("  [{:>6}ms] console({}) {}", self.ms(), line.stream, line.line);
        } else if n == 41 {
            println!("  … (further console lines suppressed)");
        }
    }
    fn stats(&self, _server_id: &str, stats: &serde_json::Value) {
        let n = self.stats_count.fetch_add(1, Ordering::Relaxed) + 1;
        if n <= 3 {
            println!(
                "  [{:>6}ms] stats cpu={} mem={}MB state={}",
                self.ms(),
                stats.get("cpuPct").and_then(|v| v.as_f64()).unwrap_or(0.0),
                stats.get("memUsedMb").and_then(|v| v.as_f64()).unwrap_or(0.0),
                stats.get("state").and_then(|v| v.as_str()).unwrap_or("?"),
            );
        }
    }
    fn status(&self, _server_id: &str, state: &str) {
        println!("  [{:>6}ms] STATUS -> {state}", self.ms());
    }
    fn conn(&self, _server_id: &str, state: &str, detail: Option<&str>, attempt: Option<u32>) {
        println!(
            "  [{:>6}ms] CONN -> {state}{}{}",
            self.ms(),
            attempt.map(|a| format!(" (attempt {a})")).unwrap_or_default(),
            detail.map(|d| format!(" — {d}")).unwrap_or_default(),
        );
    }
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let email = std::env::var("RFX_EMAIL").expect("set RFX_EMAIL");
    let password = std::env::var("RFX_PASS").expect("set RFX_PASS");

    let auth = AuthManager::new(PanelClient::from_env().expect("client"), Vault::in_memory());
    match auth.login(&email, &password, None, false).await.expect("login") {
        LoginOutcome::SignedIn => println!("1. login OK"),
        LoginOutcome::MfaRequired { .. } => {
            println!("MFA required — can't run headless");
            return;
        }
    }

    // Resolve the server id: explicit env, else the first server on the list.
    let server_id = match std::env::var("RFX_SERVER_ID") {
        Ok(id) => id,
        Err(_) => {
            let page = servers::list(&auth, None, 1, 100).await.expect("list");
            let s = page.data.first().expect("account has no servers");
            println!("2. using server '{}' [{:?}] {}", s.name, s.state, s.id);
            s.id.clone()
        }
    };

    let sink = Arc::new(StdoutSink {
        start: Instant::now(),
        console_count: AtomicUsize::new(0),
        stats_count: AtomicUsize::new(0),
    });
    // AuthManager::new already returns an Arc — clone it into the session and
    // reuse it for the out-of-band power call (they share one live session).
    let session = spawn_session(sink.clone(), auth.clone(), server_id.clone());
    println!("3. console session spawned — watching for 20s");

    // Optionally start the server to generate boot output.
    if std::env::var("RFX_START").is_ok() {
        tokio::time::sleep(Duration::from_secs(2)).await;
        println!("4. issuing power start …");
        match servers::power(&auth, &server_id, PowerSignal::Start).await {
            Ok(()) => println!("   start accepted"),
            Err(e) => println!("   start failed: {} ({})", e.user_message(), e.code()),
        }
    }

    tokio::time::sleep(Duration::from_secs(20)).await;
    session.stop();
    tokio::time::sleep(Duration::from_millis(300)).await;

    let c = sink.console_count.load(Ordering::Relaxed);
    let s = sink.stats_count.load(Ordering::Relaxed);
    println!("5. observed {c} console line(s), {s} stats frame(s)");
    println!(
        "verdict: console client {} the live server",
        if c > 0 || s > 0 {
            "RECEIVED data from"
        } else {
            "connected but saw NO data from (is it running?)"
        }
    );
}
