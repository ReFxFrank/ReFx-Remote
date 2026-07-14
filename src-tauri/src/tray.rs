//! System tray: status-aware icon menu with per-server power controls,
//! plus Open / Check for updates / Quit. Left-click restores the window.

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::panel::servers::{PowerSignal, ServerState, ServerSummary};

const TRAY_ID: &str = "main";
const MAX_SERVERS: usize = 12;

fn state_label(s: ServerState) -> &'static str {
    match s {
        ServerState::Running => "Running",
        ServerState::Starting => "Starting",
        ServerState::Stopping => "Stopping",
        ServerState::Offline => "Offline",
        ServerState::Crashed => "Crashed",
        ServerState::Suspended => "Suspended",
        ServerState::Installing => "Installing",
        ServerState::Reinstalling => "Reinstalling",
        ServerState::SwitchingGame => "Switching game",
        ServerState::Transferring => "Transferring",
        ServerState::PendingPayment => "Pending payment",
        ServerState::Unknown => "Unknown",
    }
}

fn dot(s: ServerState) -> &'static str {
    match s {
        ServerState::Running => "🟢",
        ServerState::Crashed | ServerState::Suspended | ServerState::PendingPayment => "🔴",
        ServerState::Offline | ServerState::Unknown => "⚫",
        _ => "🟡",
    }
}

/// Build the tray on startup with a placeholder menu; the monitor refreshes it.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let menu = base_menu(app, &[])?;
    let icon = app.default_window_icon().cloned().ok_or_else(|| {
        tauri::Error::AssetNotFound("default window icon".into())
    })?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("ReFx Desktop")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Rebuild the tray menu from the current server snapshot (called by the
/// monitor). Menu/tray ops are marshalled to the main thread for Windows.
pub fn set_servers(app: &AppHandle, servers: &[ServerSummary]) {
    let app = app.clone();
    let snapshot: Vec<(String, String, ServerState)> = servers
        .iter()
        .take(MAX_SERVERS)
        .map(|s| (s.id.clone(), s.name.clone(), s.state))
        .collect();
    let overflow = servers.len().saturating_sub(MAX_SERVERS);
    let _ = app.clone().run_on_main_thread(move || {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            if let Ok(menu) = build_menu(&app, &snapshot, overflow) {
                let _ = tray.set_menu(Some(menu));
            }
        }
    });
}

fn base_menu(app: &AppHandle, _servers: &[ServerSummary]) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    build_menu(app, &[], 0)
}

fn build_menu(
    app: &AppHandle,
    servers: &[(String, String, ServerState)],
    overflow: usize,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let mut mb = MenuBuilder::new(app);

    if servers.is_empty() {
        let none = MenuItemBuilder::with_id("noop", "No servers")
            .enabled(false)
            .build(app)?;
        mb = mb.item(&none);
    } else {
        for (id, name, state) in servers {
            let up = matches!(state, ServerState::Running | ServerState::Starting | ServerState::Stopping);
            let off = matches!(state, ServerState::Offline | ServerState::Crashed);
            let start = MenuItemBuilder::with_id(format!("srv:{id}:start"), "Start")
                .enabled(off)
                .build(app)?;
            let restart = MenuItemBuilder::with_id(format!("srv:{id}:restart"), "Restart")
                .enabled(up)
                .build(app)?;
            let stop = MenuItemBuilder::with_id(format!("srv:{id}:stop"), "Stop")
                .enabled(up)
                .build(app)?;
            let open = MenuItemBuilder::with_id(format!("open:{id}"), "Open").build(app)?;
            let sub = SubmenuBuilder::new(app, format!("{} {} — {}", dot(*state), name, state_label(*state)))
                .item(&open)
                .separator()
                .item(&start)
                .item(&restart)
                .item(&stop)
                .build()?;
            mb = mb.item(&sub);
        }
        if overflow > 0 {
            let more = MenuItemBuilder::with_id("noop", format!("…and {overflow} more"))
                .enabled(false)
                .build(app)?;
            mb = mb.item(&more);
        }
    }

    mb.separator()
        .text("open", "Open ReFx Desktop")
        .text("check_updates", "Check for updates")
        .separator()
        .text("quit", "Quit")
        .build()
}

fn on_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref().to_string();
    match id.as_str() {
        "open" => show_main(app),
        "quit" => app.exit(0),
        "check_updates" => {
            let _ = app.emit_to("main", "app:check-updates", ());
            show_main(app);
        }
        "noop" => {}
        other => {
            if let Some(rest) = other.strip_prefix("open:") {
                show_main(app);
                let _ = app.emit_to(
                    "main",
                    "app:open-server",
                    serde_json::json!({ "id": rest, "console": false }),
                );
            } else if let Some(rest) = other.strip_prefix("srv:") {
                // srv:{id}:{signal}
                if let Some((sid, sig)) = rest.rsplit_once(':') {
                    if let Some(signal) = PowerSignal::parse(sig) {
                        power_from_tray(app, sid.to_string(), signal);
                    }
                }
            }
        }
    }
}

fn power_from_tray(app: &AppHandle, server_id: String, signal: PowerSignal) {
    use crate::state::AppState;
    use tauri_plugin_notification::NotificationExt;
    let state = app.state::<AppState>();
    let auth = state.auth.clone();
    let intent = state.intent.clone();
    if signal.marks_intent() {
        intent.mark(&server_id);
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::panel::servers::power(&auth, &server_id, signal).await {
            // The panel rejected it (e.g. a view-only shared server, or a
            // transient error). Clear the tentative crash-suppression mark and
            // tell the user, rather than failing silently from the tray.
            intent.clear(&server_id);
            let _ = app
                .notification()
                .builder()
                .title("Action failed")
                .body(format!("Couldn't {} the server: {}", signal.verb(), e.code()))
                .show();
        }
    });
}

use tauri::Emitter;

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}
