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

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct ExitPayload {
    id: String,
    code: Option<i32>,
    error: Option<String>,
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
/// length limits). Streams stdout lines as events; emits an exit event with the
/// status code and any stderr when the process finishes.
#[tauri::command]
pub fn claude_code_run(
    app: AppHandle,
    id: String,
    prompt: String,
    cwd: String,
    model: String,
    permission_mode: Option<String>,
    oauth_token: Option<String>,
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
        let code = child.wait().ok().and_then(|s| s.code());
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
