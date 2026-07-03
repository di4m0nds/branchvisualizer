// ─── PTY bridge ─────────────────────────────────────────────────────────────
// Spawns real pseudo-terminals via portable-pty and streams their output to the
// webview as base64-encoded `pty://data/<id>` events (base64 avoids splitting a
// multibyte UTF-8 sequence across chunk boundaries — the frontend decodes to raw
// bytes and hands them to xterm, which does its own UTF-8 decoding). Terminals
// are keyed by a frontend-supplied id; roles (agent/shell/server/nvim) are a
// frontend concern — nvim is simply a PTY running the `nvim` binary.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

struct PtySession {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState(Mutex<HashMap<String, PtySession>>);

impl PtyState {
    /// Kill every live PTY child. Called on app exit so no shells are orphaned
    /// (there is otherwise no `Drop` that reaps the spawned processes).
    pub fn kill_all(&self) {
        if let Ok(mut map) = self.0.lock() {
            for (_, mut session) in map.drain() {
                let _ = session.child.kill();
            }
        }
    }
}

#[derive(Clone, Serialize)]
struct ExitPayload {
    id: String,
    code: Option<u32>,
}

/// Spawn a PTY. `cmd` defaults to the user's login shell; for the nvim role pass
/// `cmd = "nvim"` and `args = [file]`.
#[tauri::command]
pub fn spawn_pty(
    app: AppHandle,
    state: State<'_, PtyState>,
    id: String,
    cmd: Option<String>,
    args: Vec<String>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let shell = cmd.unwrap_or_else(default_shell);
    let mut builder = CommandBuilder::new(&shell);

    // Login-shell flag for known interactive shells so rc files (which set up
    // PATH, prompt, aliases) are sourced — otherwise zsh/bash can exit right
    // away and the user sees `[process exited]`. Only when no explicit cmd/args
    // were supplied (i.e. this is a plain shell, not `nvim <file>`).
    if args.is_empty() && is_login_shell(&shell) {
        builder.arg("-l");
    }
    for a in &args {
        builder.arg(a);
    }

    // portable-pty does NOT inherit the parent environment by default. Without
    // HOME/PATH/USER/LANG a login shell (and nvim's runtime lookup) fails
    // immediately. Forward the parent env, then override TERM for xterm.
    for (k, v) in std::env::vars() {
        if k == "TERM" {
            continue;
        }
        builder.env(k, v);
    }
    builder.env("TERM", "xterm-256color");
    // Tell TUIs (nvim's `termguicolors`, bat, tmux) that 24-bit color is safe.
    builder.env("COLORTERM", "truecolor");
    // Guarantee a UTF-8 locale so wide chars and box-drawing render correctly
    // even when the parent env is bare (fresh service accounts, minimal shells).
    if std::env::var("LANG").ok().filter(|v| !v.is_empty()).is_none() {
        builder.env("LANG", "C.UTF-8");
    }

    // Validate cwd: fall back to HOME (then /) when empty or missing, so an
    // invalid working dir doesn't silently kill the child.
    let dir = resolve_cwd(&cwd);
    builder.cwd(&dir);

    let child = pair
        .slave
        .spawn_command(builder)
        .map_err(|e| format!("failed to spawn {shell} in {dir}: {e}"))?;
    // Slave is held by the child; drop our handle so EOF propagates on exit.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer failed: {e}"))?;

    // Read pump: stream output to the webview until EOF, then emit exit.
    let data_event = format!("pty://data/{id}");
    let exit_id = id.clone();
    let app_clone = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    // Best-effort: if the webview is gone, stop pumping.
                    if app_clone.emit(&data_event, encoded).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = app_clone.emit(
            "pty://exit",
            ExitPayload {
                id: exit_id,
                code: None,
            },
        );
    });

    let mut map = state.0.lock().unwrap();
    // Evict any stale session reusing this id (e.g. a StrictMode double-mount
    // whose first spawn resolved after cleanup) so we never leave two live
    // shells both pumping to `pty://data/<id>`.
    if let Some(mut old) = map.remove(&id) {
        let _ = old.child.kill();
    }
    map.insert(
        id,
        PtySession {
            master: pair.master,
            writer,
            child,
        },
    );
    Ok(())
}

/// Write keystrokes / bytes to a PTY.
#[tauri::command]
pub fn write_pty(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    let session = map.get_mut(&id).ok_or("no such terminal")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write failed: {e}"))?;
    session.writer.flush().map_err(|e| format!("flush failed: {e}"))
}

/// Resize a PTY (on xterm fit).
#[tauri::command]
pub fn resize_pty(
    state: State<'_, PtyState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = state.0.lock().unwrap();
    let session = map.get(&id).ok_or("no such terminal")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize failed: {e}"))
}

/// Kill a PTY and drop its handle.
#[tauri::command]
pub fn kill_pty(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    if let Some(mut session) = state.0.lock().unwrap().remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}

fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

/// Whether a shell binary path is a login shell that accepts `-l`.
fn is_login_shell(shell: &str) -> bool {
    let name = std::path::Path::new(shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(shell);
    matches!(name, "bash" | "zsh" | "sh" | "fish")
}

/// Resolve a usable working directory: the requested cwd if it exists, else
/// $HOME, else `/`. Prevents an invalid path from silently killing the child.
fn resolve_cwd(cwd: &str) -> String {
    if !cwd.is_empty() && std::path::Path::new(cwd).is_dir() {
        return cwd.to_string();
    }
    std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
}
