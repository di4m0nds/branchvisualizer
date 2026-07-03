// ─── Container runtime bridge (Docker / Podman) ──────────────────────────────
// Backs the IDE's Runtime Environment panel. Shells out to the `docker`/`podman`
// CLI via arg-vector `Command` (never `sh -c`) so there is no shell-injection
// surface — mirrors `git.rs`'s `run_git`. Live stats/logs stream to the webview
// over a `runtime://` event channel, mirroring the PTY / claude-code bridges:
//   `runtime://data/<id>`  — one line (JSON stats row or a log line) per emit
//   `runtime://exit`       — { id, code } once the streaming child ends
//
// The container engine is chosen by the frontend (`bin`), validated against a
// strict allow-list here. Destructive actions are additionally gated in the UI.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ─── Validation ──────────────────────────────────────────────────────────────

/// Only these engines may be invoked. Everything the frontend passes as `bin`
/// funnels through here so a bad value can never become an arbitrary binary.
fn valid_bin(bin: &str) -> bool {
    matches!(bin, "docker" | "podman")
}

/// Allow-list of lifecycle actions the panel may run (see `docker_action`).
fn valid_action(action: &str) -> bool {
    matches!(
        action,
        "start" | "stop" | "restart" | "rm" | "pull" | "build" | "prune" | "up" | "down"
    )
}

// ─── One-shot helpers ────────────────────────────────────────────────────────

/// Run a container-engine subcommand and return stdout on success (arg-vector,
/// no shell). Modeled on `git.rs::run_git`.
fn run_docker(bin: &str, args: &[&str], cwd: Option<&str>) -> Result<String, String> {
    if !valid_bin(bin) {
        return Err(format!("unsupported container engine: {bin}"));
    }
    let mut cmd = Command::new(bin);
    cmd.args(args);
    if let Some(dir) = cwd {
        if !dir.is_empty() && Path::new(dir).is_dir() {
            cmd.current_dir(dir);
        }
    }
    let output = cmd
        .output()
        .map_err(|e| format!("failed to spawn {bin}: {e}. Is it installed and on PATH?"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{bin} {}: {}", args.join(" "), stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    stdout: String,
    stderr: String,
    code: Option<i32>,
}

/// Like `run_docker` but returns the full result (incl. stderr/code) even on
/// failure, so the UI can surface what went wrong. Used for lifecycle actions.
fn run_docker_capture(bin: &str, args: &[&str], cwd: Option<&str>) -> Result<CommandResult, String> {
    if !valid_bin(bin) {
        return Err(format!("unsupported container engine: {bin}"));
    }
    let mut cmd = Command::new(bin);
    cmd.args(args);
    if let Some(dir) = cwd {
        if !dir.is_empty() && Path::new(dir).is_dir() {
            cmd.current_dir(dir);
        }
    }
    let output = cmd
        .output()
        .map_err(|e| format!("failed to spawn {bin}: {e}"))?;
    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        code: output.status.code(),
    })
}

// ─── Detection ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    /// "docker" | "podman" | null when neither is on PATH.
    engine: Option<String>,
    version: Option<String>,
    /// Compose file name found in `cwd`, if any.
    compose_file: Option<String>,
    has_dockerfile: bool,
    /// e.g. "docker compose" — how to invoke compose for this engine.
    compose_command: Option<String>,
}

fn engine_version(bin: &str) -> Option<String> {
    let out = Command::new(bin).arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Detect the container engine and any compose/Dockerfile in the project root.
#[tauri::command]
pub fn runtime_detect(cwd: String) -> RuntimeInfo {
    // Prefer docker, then podman.
    let (engine, version) = if let Some(v) = engine_version("docker") {
        (Some("docker".to_string()), Some(v))
    } else if let Some(v) = engine_version("podman") {
        (Some("podman".to_string()), Some(v))
    } else {
        (None, None)
    };

    let mut compose_file = None;
    if !cwd.is_empty() {
        for name in [
            "docker-compose.yml",
            "docker-compose.yaml",
            "compose.yml",
            "compose.yaml",
        ] {
            if Path::new(&cwd).join(name).is_file() {
                compose_file = Some(name.to_string());
                break;
            }
        }
    }
    let has_dockerfile = !cwd.is_empty() && Path::new(&cwd).join("Dockerfile").is_file();
    let compose_command = engine.as_deref().map(|e| format!("{e} compose"));

    RuntimeInfo {
        engine,
        version,
        compose_file,
        has_dockerfile,
        compose_command,
    }
}

// ─── Containers ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Container {
    id: String,
    name: String,
    image: String,
    /// running | exited | created | paused | restarting | dead
    state: String,
    /// Human status string, e.g. "Up 3 minutes (healthy)".
    status: String,
    /// healthy | unhealthy | starting | null (parsed from `status`).
    health: Option<String>,
    ports: String,
    /// docker's "RunningFor" string, e.g. "3 minutes ago".
    uptime: String,
}

/// Extract a health keyword from docker's human status string.
fn parse_health(status: &str) -> Option<String> {
    let s = status.to_lowercase();
    if s.contains("(healthy)") {
        Some("healthy".into())
    } else if s.contains("(unhealthy)") {
        Some("unhealthy".into())
    } else if s.contains("health: starting") || s.contains("(starting)") {
        Some("starting".into())
    } else {
        None
    }
}

/// List all containers (`ps -a`). Parses docker's `{{json .}}` NDJSON leniently
/// so both docker's and podman's key casings are tolerated.
#[tauri::command]
pub fn docker_ps(bin: String) -> Result<Vec<Container>, String> {
    let raw = run_docker(&bin, &["ps", "-a", "--format", "{{json .}}"], None)?;
    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let get = |keys: &[&str]| -> String {
            for k in keys {
                if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
                    return s.to_string();
                }
            }
            String::new()
        };
        let status = get(&["Status", "status"]);
        out.push(Container {
            id: get(&["ID", "Id", "id"]),
            name: get(&["Names", "name"]),
            image: get(&["Image", "image"]),
            state: get(&["State", "state"]),
            health: parse_health(&status),
            status,
            ports: get(&["Ports", "ports"]),
            uptime: get(&["RunningFor", "runningFor"]),
        });
    }
    Ok(out)
}

// ─── Compose services ────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeService {
    name: String,
    depends_on: Vec<String>,
    image: Option<String>,
    /// "published:target" strings (published = host port).
    ports: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeConfig {
    services: Vec<ComposeService>,
}

fn val_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// `depends_on` is either an array of names or an object keyed by name.
fn parse_depends_on(v: Option<&serde_json::Value>) -> Vec<String> {
    match v {
        Some(serde_json::Value::Array(a)) => {
            a.iter().filter_map(|x| x.as_str().map(String::from)).collect()
        }
        Some(serde_json::Value::Object(o)) => o.keys().cloned().collect(),
        _ => Vec::new(),
    }
}

/// `ports` is an array of "host:container" strings or normalized objects.
fn parse_ports(v: Option<&serde_json::Value>) -> Vec<String> {
    let arr = match v.and_then(|x| x.as_array()) {
        Some(a) => a,
        None => return Vec::new(),
    };
    arr.iter()
        .map(|p| {
            if let Some(s) = p.as_str() {
                return s.to_string();
            }
            let published = p.get("published").map(val_to_string).unwrap_or_default();
            let target = p.get("target").map(val_to_string).unwrap_or_default();
            if !published.is_empty() {
                format!("{published}:{target}")
            } else {
                target
            }
        })
        .collect()
}

/// Resolve the compose file's service graph (`compose config --format json`).
#[tauri::command]
pub fn docker_compose_services(bin: String, cwd: String) -> Result<ComposeConfig, String> {
    let raw = run_docker(&bin, &["compose", "config", "--format", "json"], Some(&cwd))?;
    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("parse compose config: {e}"))?;
    let mut services = Vec::new();
    if let Some(map) = v.get("services").and_then(|s| s.as_object()) {
        for (name, svc) in map {
            services.push(ComposeService {
                name: name.clone(),
                depends_on: parse_depends_on(svc.get("depends_on")),
                image: svc.get("image").and_then(|x| x.as_str()).map(String::from),
                ports: parse_ports(svc.get("ports")),
            });
        }
    }
    Ok(ComposeConfig { services })
}

// ─── Streaming (stats / logs) ────────────────────────────────────────────────

type ChildMap = Arc<Mutex<HashMap<String, Child>>>;
static CHILDREN: OnceLock<ChildMap> = OnceLock::new();
fn children() -> ChildMap {
    CHILDREN
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

#[derive(Clone, Serialize)]
struct ExitPayload {
    id: String,
    code: Option<i32>,
}

/// Spawn a long-running engine command and stream its stdout lines to the
/// webview on `runtime://data/<id>`, emitting `runtime://exit` when it ends.
fn spawn_stream(
    app: AppHandle,
    id: String,
    bin: &str,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    if !valid_bin(bin) {
        return Err(format!("unsupported container engine: {bin}"));
    }
    let mut cmd = Command::new(bin);
    cmd.args(&args);
    if let Some(dir) = &cwd {
        if !dir.is_empty() && Path::new(dir).is_dir() {
            cmd.current_dir(dir);
        }
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn {bin}: {e}"))?;
    let stdout = child.stdout.take().ok_or("failed to capture stdout")?;

    // Evict any stale stream reusing this id so we never leave two pumps on one
    // channel (mirrors the PTY stale-id guard).
    if let Some(mut old) = children().lock().unwrap().insert(id.clone(), child) {
        let _ = old.kill();
        let _ = old.wait();
    }

    let data_event = format!("runtime://data/{id}");
    let exit_id = id;
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
        let code = {
            let mut opt = children().lock().unwrap().remove(&exit_id);
            opt.as_mut().and_then(|c| c.wait().ok().and_then(|s| s.code()))
        };
        let _ = app.emit("runtime://exit", ExitPayload { id: exit_id, code });
    });

    Ok(())
}

/// Stream live resource stats (`stats --format {{json .}}`, one row per
/// container per interval).
#[tauri::command]
pub fn docker_stats_stream(app: AppHandle, id: String, bin: String) -> Result<(), String> {
    spawn_stream(
        app,
        id,
        &bin,
        vec![
            "stats".into(),
            "--format".into(),
            "{{json .}}".into(),
        ],
        None,
    )
}

/// Follow logs for a container id/name, or a compose service when `compose` is set.
#[tauri::command]
pub fn docker_logs_stream(
    app: AppHandle,
    id: String,
    bin: String,
    target: String,
    cwd: Option<String>,
    compose: bool,
) -> Result<(), String> {
    if target.starts_with('-') {
        return Err(format!("invalid target: {target}"));
    }
    let args = if compose {
        vec![
            "compose".into(),
            "logs".into(),
            "-f".into(),
            "--tail".into(),
            "200".into(),
            target,
        ]
    } else {
        vec![
            "logs".into(),
            "-f".into(),
            "--tail".into(),
            "200".into(),
            target,
        ]
    };
    spawn_stream(app, id, &bin, args, cwd)
}

/// Kill one streaming child by id. Best-effort.
#[tauri::command]
pub fn docker_kill(id: String) -> Result<(), String> {
    if let Some(mut child) = children().lock().unwrap().remove(&id) {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// Kill every streaming child. Called on app exit so no `docker stats`/`logs -f`
/// processes are orphaned.
pub fn kill_all_children() {
    if let Ok(mut map) = children().lock() {
        for (_, mut child) in map.drain() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// ─── Lifecycle actions ───────────────────────────────────────────────────────

/// Run an allow-listed lifecycle action. Container-level actions take a
/// `target` (id/name); compose-level ones (up/down, or build/pull with no
/// target) run in `cwd`. Destructive actions are additionally confirmed in the UI.
#[tauri::command]
pub fn docker_action(
    bin: String,
    action: String,
    target: Option<String>,
    cwd: Option<String>,
) -> Result<CommandResult, String> {
    if !valid_bin(&bin) {
        return Err(format!("unsupported container engine: {bin}"));
    }
    if !valid_action(&action) {
        return Err(format!("unsupported action: {action}"));
    }
    let target = target.unwrap_or_default();
    if target.starts_with('-') {
        return Err(format!("invalid target: {target}"));
    }

    let mut args: Vec<String> = Vec::new();
    match action.as_str() {
        "prune" => {
            args.push("system".into());
            args.push("prune".into());
            args.push("-f".into());
        }
        "up" => {
            args.push("compose".into());
            args.push("up".into());
            args.push("-d".into());
        }
        "down" => {
            args.push("compose".into());
            args.push("down".into());
        }
        "build" if target.is_empty() => {
            args.push("compose".into());
            args.push("build".into());
        }
        "pull" if target.is_empty() => {
            args.push("compose".into());
            args.push("pull".into());
        }
        other => {
            args.push(other.into());
            if !target.is_empty() {
                args.push(target.clone());
            }
        }
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_docker_capture(&bin, &arg_refs, cwd.as_deref())
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bin_allow_list() {
        assert!(valid_bin("docker"));
        assert!(valid_bin("podman"));
        assert!(!valid_bin("sh"));
        assert!(!valid_bin("docker; rm -rf /"));
        assert!(!valid_bin(""));
    }

    #[test]
    fn action_allow_list() {
        for a in ["start", "stop", "restart", "rm", "pull", "build", "prune", "up", "down"] {
            assert!(valid_action(a), "{a} should be allowed");
        }
        assert!(!valid_action("exec"));
        assert!(!valid_action("run"));
        assert!(!valid_action("--privileged"));
    }

    #[test]
    fn health_parsing() {
        assert_eq!(parse_health("Up 3 minutes (healthy)").as_deref(), Some("healthy"));
        assert_eq!(parse_health("Up 1 second (unhealthy)").as_deref(), Some("unhealthy"));
        assert_eq!(parse_health("Up 2 seconds (health: starting)").as_deref(), Some("starting"));
        assert_eq!(parse_health("Exited (0) 5 minutes ago"), None);
    }

    #[test]
    fn depends_on_shapes() {
        let arr = serde_json::json!(["db", "cache"]);
        assert_eq!(parse_depends_on(Some(&arr)), vec!["db", "cache"]);
        let obj = serde_json::json!({ "db": { "condition": "service_healthy" } });
        assert_eq!(parse_depends_on(Some(&obj)), vec!["db"]);
        assert!(parse_depends_on(None).is_empty());
    }

    #[test]
    fn port_shapes() {
        let strs = serde_json::json!(["8080:80", "5432:5432"]);
        assert_eq!(parse_ports(Some(&strs)), vec!["8080:80", "5432:5432"]);
        let objs = serde_json::json!([{ "published": 8080, "target": 80, "protocol": "tcp" }]);
        assert_eq!(parse_ports(Some(&objs)), vec!["8080:80"]);
        assert!(parse_ports(None).is_empty());
    }
}
