// ─── Antigravity (Google Antigravity SDK) subprocess bridge ──────────────────
// The Google Antigravity SDK is a *Python* agent framework (pip
// `google-antigravity`) built on google-genai. Like Claude Code it is a
// *complete* agent — it runs its own loop / tools / MCP against a workspace and
// reports back — so we drive it as a headless subprocess and relay its output,
// rather than treating it as a thin model client. This app is TS + Rust
// (Tauri), so the bridge is a tiny inlined Python script executed via
// `python3 -c`, fed a JSON config on stdin, streaming NDJSON on stdout.
//
// Events (mirrors the claude_code bridge shape):
//   `antigravity://data/<id>`  — one NDJSON line per emit
//   `antigravity://exit`       — { id, code, error } once the process ends
//
// NDJSON lines the bridge emits:
//   {"type":"text","text":"…"}          streamed assistant text
//   {"type":"tool_call","name":"…"}     a tool the agent invoked (best-effort)
//   {"type":"result","model":"…","usage":{…}}  final, once per turn
//   {"type":"error","error":"…"}        a failure the bridge caught

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};

// Inlined Python bridge. Reads a JSON config from stdin, runs one Antigravity
// chat turn, streams NDJSON to stdout. Kept dependency-free beyond the SDK.
const BRIDGE: &str = r#"
import sys, json, asyncio

def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

async def run(cfg):
    try:
        import google.antigravity as ag
    except Exception as e:
        emit({"type": "error", "error": "google-antigravity not importable: %s" % e})
        return
    model = cfg.get("model") or "gemini-2.5-flash"
    workspaces = [cfg["cwd"]] if cfg.get("cwd") else None
    try:
        conf = ag.LocalAgentConfig(
            system_instructions=cfg.get("system") or None,
            model=model,
            api_key=cfg.get("apiKey") or None,
            workspaces=workspaces,
        )
    except Exception as e:
        emit({"type": "error", "error": "config error: %s" % e})
        return
    try:
        async with ag.Agent(conf) as agent:
            resp = await agent.chat(cfg.get("prompt") or "")
            got_text = False
            async for chunk in resp:
                if chunk:
                    got_text = True
                    emit({"type": "text", "text": chunk})
            if not got_text:
                try:
                    txt = await resp.text()
                    if txt:
                        emit({"type": "text", "text": txt})
                except Exception:
                    pass
            try:
                for tc in (getattr(resp, "tool_calls", None) or []):
                    name = getattr(tc, "name", None)
                    if name is None and isinstance(tc, dict):
                        name = tc.get("name")
                    if name:
                        emit({"type": "tool_call", "name": str(name)})
            except Exception:
                pass
            usage = {}
            try:
                um = getattr(resp, "usage_metadata", None)
                if um is not None:
                    def g(o, k):
                        return o.get(k) if isinstance(o, dict) else getattr(o, k, None)
                    inp = g(um, "prompt_token_count")
                    out = g(um, "candidates_token_count")
                    tot = g(um, "total_token_count")
                    if inp is not None: usage["input"] = inp
                    if out is not None: usage["output"] = out
                    if tot is not None: usage["total"] = tot
            except Exception:
                pass
            emit({"type": "result", "model": model, "usage": usage})
    except Exception as e:
        emit({"type": "error", "error": str(e)})

def main():
    raw = sys.stdin.read()
    try:
        cfg = json.loads(raw) if raw.strip() else {}
    except Exception as e:
        emit({"type": "error", "error": "bad config json: %s" % e})
        return
    asyncio.run(run(cfg))

main()
"#;

#[derive(Clone, Serialize)]
struct ExitPayload {
    id: String,
    code: Option<i32>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityProbe {
    detected: bool,
    version: Option<String>,
    python: Option<String>,
    error: Option<String>,
}

// ─── python discovery ────────────────────────────────────────────────────────
// Resolve the interpreter once. Prefer `python3`, fall back to `python`.
static PYTHON: OnceLock<Option<String>> = OnceLock::new();
fn python_bin() -> Option<String> {
    PYTHON
        .get_or_init(|| {
            for cand in ["python3", "python"] {
                if Command::new(cand).arg("--version").output().map(|o| o.status.success()).unwrap_or(false) {
                    return Some(cand.to_string());
                }
            }
            None
        })
        .clone()
}

// ─── In-flight process registry ──────────────────────────────────────────────
type ChildMap = Arc<Mutex<HashMap<String, Child>>>;
static CHILDREN: OnceLock<ChildMap> = OnceLock::new();
fn children() -> ChildMap {
    CHILDREN.get_or_init(|| Arc::new(Mutex::new(HashMap::new()))).clone()
}

/// Check that the Antigravity SDK is importable by the resolved interpreter and
/// report its version. Cheap liveness probe for the provider status pill.
#[tauri::command]
pub fn antigravity_check() -> Result<AntigravityProbe, String> {
    let py = match python_bin() {
        Some(p) => p,
        None => {
            return Ok(AntigravityProbe {
                detected: false,
                version: None,
                python: None,
                error: Some("python3 not on PATH".to_string()),
            })
        }
    };
    let out = Command::new(&py)
        .arg("-c")
        .arg("import importlib.metadata as m; print(m.version('google-antigravity'))")
        .output();
    match out {
        Ok(o) if o.status.success() => Ok(AntigravityProbe {
            detected: true,
            version: Some(String::from_utf8_lossy(&o.stdout).trim().to_string()),
            python: Some(py),
            error: None,
        }),
        Ok(o) => Ok(AntigravityProbe {
            detected: false,
            version: None,
            python: Some(py),
            error: Some(String::from_utf8_lossy(&o.stderr).trim().to_string()),
        }),
        Err(e) => Ok(AntigravityProbe {
            detected: false,
            version: None,
            error: Some(format!("failed to run {py}: {e}")),
            python: Some(py),
        }),
    }
}

/// Run one Antigravity chat turn. Config (prompt/system/model/apiKey/cwd) is
/// passed as a single JSON line on stdin; NDJSON output is streamed as events.
#[tauri::command]
pub fn antigravity_run(
    app: AppHandle,
    id: String,
    prompt: String,
    cwd: String,
    model: String,
    system: Option<String>,
    api_key: Option<String>,
) -> Result<(), String> {
    let py = python_bin().ok_or("python3 not found on PATH")?;

    let dir = if !cwd.is_empty() && std::path::Path::new(&cwd).is_dir() {
        cwd
    } else {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    };

    let cfg = json!({
        "prompt": prompt,
        "cwd": dir,
        "model": model,
        "system": system,
        "apiKey": api_key,
    })
    .to_string();

    let mut cmd = Command::new(&py);
    cmd.arg("-c").arg(BRIDGE);
    cmd.current_dir(&dir);
    cmd.env("PYTHONUNBUFFERED", "1");
    // Also surface the key via the env vars google-genai reads, belt-and-suspenders.
    if let Some(k) = api_key.as_deref() {
        if !k.is_empty() {
            cmd.env("GEMINI_API_KEY", k);
            cmd.env("GOOGLE_API_KEY", k);
        }
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn `{py}` for Antigravity bridge: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(cfg.as_bytes());
        // stdin dropped here → EOF, bridge starts processing.
    }

    let stdout = child.stdout.take().ok_or("failed to capture bridge stdout")?;

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

    children().lock().unwrap().insert(id.clone(), child);

    let data_event = format!("antigravity://data/{id}");
    let exit_id = id;
    let stderr_for_exit = stderr_buf;
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    if app.emit(&data_event, l).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
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
            "antigravity://exit",
            ExitPayload { id: exit_id, code, error },
        );
    });

    Ok(())
}

/// Kill an in-flight Antigravity bridge subprocess by run id. Best-effort.
#[tauri::command]
pub fn antigravity_kill(id: String) -> Result<(), String> {
    if let Some(mut child) = children().lock().unwrap().remove(&id) {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// Kill every in-flight Antigravity bridge subprocess. Called on app exit.
pub fn kill_all_children() {
    if let Ok(mut map) = children().lock() {
        for (_, mut child) in map.drain() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
