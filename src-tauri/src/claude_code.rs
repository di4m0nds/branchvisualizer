// ─── Claude Code subprocess bridge ──────────────────────────────────────────
// Runs the local `claude` CLI in headless streaming mode (`-p --output-format
// stream-json`) and relays its NDJSON output to the webview. Unlike the API
// providers, Claude Code is a *complete* agent: it runs its own tools (read /
// write / bash) inside `cwd` and its own agent loop, then reports back. We just
// stream what it prints. This is the legitimate way to use a Claude Code OAuth
// token (`claude setup-token`) — the CLI authenticates as Claude Code itself, so
// there is no direct-API / CORS policy wall.
//
// Events (mirrors the pty bridge shape):
//   `claude-code://data/<id>`  — one NDJSON line per emit
//   `claude-code://exit`       — { id, code, error } once the process ends
//
// The IDE's chat conventions (`<questions_for_user>`, `<thinking>`, lightweight
// Markdown) reach the model through the CLI's own `--append-system-prompt`
// channel — NOT through the stdin prompt. Trying to prepend instructions to the
// user turn triggered Claude's prompt-injection guard and the model rejected the
// framing outright. The append-system channel is the sanctioned route.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct ExitPayload {
    id: String,
    code: Option<i32>,
    error: Option<String>,
}

// ─── In-flight process registry ──────────────────────────────────────────────
// Keyed by the caller-supplied run id. The reader thread reads stdout to EOF,
// then removes the child from the map and calls `wait()` for the exit code.
// `claude_code_kill` removes the child eagerly and calls `.kill()`; that closes
// stdout, so the reader thread's next line returns EOF and it cleans up
// normally — with `wait()` returning immediately because the process is gone.

type ChildMap = Arc<Mutex<HashMap<String, Child>>>;
static CHILDREN: OnceLock<ChildMap> = OnceLock::new();
fn children() -> ChildMap {
    CHILDREN
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

/// Permission modes we allow through to the CLI. Anything else falls back to a
/// conservative `default` so a bad string can't escalate to skip-all-prompts.
fn sanitize_mode(mode: Option<String>) -> String {
    match mode.as_deref() {
        Some("plan") | Some("default") | Some("acceptEdits") | Some("bypassPermissions") => {
            mode.unwrap()
        }
        _ => "default".to_string(),
    }
}

/// Spawn `claude -p` for one turn. `prompt` is written to stdin (avoids arg
/// length limits). `append_system` is passed through the CLI's own
/// `--append-system-prompt` flag (sanctioned channel; won't trigger prompt-
/// injection refusals the way in-band prepending does). Streams stdout lines as
/// events; emits an exit event with the status code and any stderr when the
/// process finishes.
#[tauri::command]
pub fn claude_code_run(
    app: AppHandle,
    id: String,
    prompt: String,
    cwd: String,
    model: String,
    permission_mode: Option<String>,
    oauth_token: Option<String>,
    append_system: Option<String>,
) -> Result<(), String> {
    // Validate cwd: fall back to HOME (then /) so an invalid dir doesn't kill
    // the child immediately.
    let dir = if !cwd.is_empty() && std::path::Path::new(&cwd).is_dir() {
        cwd
    } else {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    };

    let mut cmd = Command::new("claude");
    cmd.arg("-p")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .arg("--permission-mode")
        .arg(sanitize_mode(permission_mode));
    if !model.is_empty() {
        cmd.arg("--model").arg(&model);
    }
    if let Some(text) = append_system.as_deref() {
        if !text.trim().is_empty() {
            cmd.arg("--append-system-prompt").arg(text);
        }
    }
    cmd.current_dir(&dir);

    // Command inherits the parent environment by default, so an exported
    // CLAUDE_CODE_OAUTH_TOKEN is already visible. When the app resolved a token
    // itself (keychain / env via get_provider_key) inject it explicitly.
    if let Some(tok) = oauth_token {
        if !tok.is_empty() {
            cmd.env("CLAUDE_CODE_OAUTH_TOKEN", tok);
        }
    }

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn `claude` (is it on PATH?): {e}"))?;

    // Feed the prompt, then close stdin so the CLI starts processing.
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt.as_bytes());
        // stdin dropped here → EOF.
    }

    let stdout = child.stdout.take().ok_or("failed to capture claude stdout")?;

    // Drain stderr on its own thread so a chatty CLI can't deadlock on a full
    // pipe while we're reading stdout.
    let stderr_buf = Arc::new(Mutex::new(String::new()));
    if let Some(stderr) = child.stderr.take() {
        let buf = stderr_buf.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(mut b) = buf.lock() {
                    b.push_str(&line);
                    b.push('\n');
                }
            }
        });
    }

    // Register the child so `claude_code_kill` can look it up by id.
    children().lock().unwrap().insert(id.clone(), child);

    let data_event = format!("claude-code://data/{id}");
    let exit_id = id;
    let stderr_for_exit = stderr_buf;
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    if app.emit(&data_event, l).is_err() {
                        break; // webview gone
                    }
                }
                Err(_) => break,
            }
        }
        // stdout closed — process is either done or was killed. Remove from
        // the registry and wait() to reap it.
        let code = {
            let mut opt = children().lock().unwrap().remove(&exit_id);
            opt.as_mut().and_then(|c| c.wait().ok().and_then(|s| s.code()))
        };
        let error = stderr_for_exit
            .lock()
            .ok()
            .map(|b| b.trim().to_string())
            .filter(|s| !s.is_empty());
        let _ = app.emit(
            "claude-code://exit",
            ExitPayload {
                id: exit_id,
                code,
                error,
            },
        );
    });

    Ok(())
}

/// Kill an in-flight `claude` subprocess by run id. Best-effort — silently
/// no-op when the id is unknown (already exited or never started). The reader
/// thread will still emit an exit event once stdout closes.
#[tauri::command]
pub fn claude_code_kill(id: String) -> Result<(), String> {
    if let Some(mut child) = children().lock().unwrap().remove(&id) {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// Kill every in-flight `claude` subprocess. Called on app exit so long-running
/// agent CLIs aren't orphaned when the window closes.
pub fn kill_all_children() {
    if let Ok(mut map) = children().lock() {
        for (_, mut child) in map.drain() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
