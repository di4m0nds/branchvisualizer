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
pub(crate) fn valid_bin(bin: &str) -> bool {
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
pub(crate) fn run_docker(bin: &str, args: &[&str], cwd: Option<&str>) -> Result<String, String> {
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
pub(crate) fn run_docker_capture(bin: &str, args: &[&str], cwd: Option<&str>) -> Result<CommandResult, String> {
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EngineProbe {
    name: String,
    version: Option<String>,
    /// Daemon/service reachable (`<bin> info` succeeded). `docker --version`
    /// succeeds with a dead daemon, so this is the real usability signal.
    alive: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    /// Every installed engine with its liveness — the UI renders a switcher.
    engines: Vec<EngineProbe>,
    /// The chosen default engine ("docker" | "podman" | null when none installed).
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

/// Probe one engine: None when not installed; alive = `<bin> info` succeeds.
fn probe_engine(bin: &str) -> Option<EngineProbe> {
    let version = engine_version(bin)?;
    let alive = Command::new(bin)
        .arg("info")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    Some(EngineProbe { name: bin.to_string(), version: Some(version), alive })
}

/// Pure engine choice: preferred-if-alive → podman-if-alive → docker-if-alive →
/// first installed (even dead, so the UI can show a daemon-down badge) → None.
fn choose_engine(probes: &[EngineProbe], preferred: Option<&str>) -> Option<String> {
    if let Some(p) = preferred {
        if probes.iter().any(|e| e.name == p && e.alive) {
            return Some(p.to_string());
        }
    }
    for name in ["podman", "docker"] {
        if probes.iter().any(|e| e.name == name && e.alive) {
            return Some(name.to_string());
        }
    }
    probes.first().map(|e| e.name.clone())
}

/// Detect the container engines and any compose/Dockerfile in the project root.
#[tauri::command]
pub fn runtime_detect(cwd: String, preferred: Option<String>) -> RuntimeInfo {
    let engines: Vec<EngineProbe> = ["docker", "podman"]
        .iter()
        .filter_map(|bin| probe_engine(bin))
        .collect();
    let engine = choose_engine(&engines, preferred.as_deref());
    let version = engine
        .as_deref()
        .and_then(|name| engines.iter().find(|e| e.name == name))
        .and_then(|e| e.version.clone());

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
        engines,
        engine,
        version,
        compose_file,
        has_dockerfile,
        compose_command,
    }
}

/// Raw `inspect` JSON for one container (array on both engines; frontend parses).
#[tauri::command]
pub fn docker_inspect(bin: String, target: String) -> Result<String, String> {
    if !valid_bin(&bin) {
        return Err(format!("unsupported container engine: {bin}"));
    }
    if target.is_empty() || target.starts_with('-') {
        return Err(format!("invalid container: {target}"));
    }
    run_docker(&bin, &["inspect", &target], None)
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
    /// Human status string, e.g. "Up 3 minutes (healthy)" (may be empty on podman).
    status: String,
    /// healthy | unhealthy | starting | null (parsed from `status`).
    health: Option<String>,
    ports: String,
    /// Human uptime for running containers, e.g. "2h 15m".
    uptime: String,
    restart_count: u32,
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

/// Read a string field that may be a plain string (docker) or an array whose
/// first element is the value (podman `Names`).
fn first_str(v: &serde_json::Value, keys: &[&str]) -> String {
    for k in keys {
        match v.get(*k) {
            Some(serde_json::Value::String(s)) if !s.is_empty() => return s.clone(),
            Some(serde_json::Value::Array(a)) => {
                if let Some(s) = a.first().and_then(|x| x.as_str()) {
                    return s.to_string();
                }
            }
            _ => {}
        }
    }
    String::new()
}

/// Best-effort ports string across engines: docker's "Ports" string, else
/// podman's `ExposedPorts` object keys.
fn extract_ports(v: &serde_json::Value) -> String {
    if let Some(s) = v.get("Ports").and_then(|x| x.as_str()) {
        if !s.is_empty() {
            return s.to_string();
        }
    }
    if let Some(obj) = v.get("ExposedPorts").and_then(|x| x.as_object()) {
        let mut ks: Vec<String> = obj.keys().cloned().collect();
        ks.sort();
        return ks.join(", ");
    }
    String::new()
}

/// Format seconds-since-`started_at` as a compact human uptime.
fn human_uptime(started_at: i64) -> String {
    if started_at <= 0 {
        return String::new();
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let d = (now - started_at).max(0);
    if d < 60 {
        format!("{d}s")
    } else if d < 3600 {
        format!("{}m", d / 60)
    } else if d < 86_400 {
        format!("{}h {}m", d / 3600, (d % 3600) / 60)
    } else {
        format!("{}d {}h", d / 86_400, (d % 86_400) / 3600)
    }
}

/// List all containers (`ps -a`). Normalizes the two engines' differing JSON:
/// docker emits string fields + `RunningFor`; podman emits `Names` as an array,
/// `StartedAt`/`Restarts` numbers, and an often-empty `Status`.
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
        let status = first_str(&v, &["Status", "status"]);
        let state = first_str(&v, &["State", "state"]);
        // Uptime: podman via StartedAt (unix secs) for running containers; docker
        // via its "RunningFor" string.
        let started_at = v.get("StartedAt").and_then(|x| x.as_i64()).unwrap_or(0);
        let uptime = if state == "running" && started_at > 0 {
            human_uptime(started_at)
        } else {
            first_str(&v, &["RunningFor", "runningFor"])
        };
        out.push(Container {
            id: first_str(&v, &["ID", "Id", "id"]),
            name: first_str(&v, &["Names", "name"]),
            image: first_str(&v, &["Image", "image"]),
            state,
            health: parse_health(&status),
            status,
            ports: extract_ports(&v),
            uptime,
            restart_count: v
                .get("Restarts")
                .or_else(|| v.get("RestartCount"))
                .and_then(|x| x.as_u64())
                .unwrap_or(0) as u32,
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
pub(crate) fn spawn_stream(
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

/// Run a one-shot command inside a container (`exec <target> sh -c <command>`)
/// and capture its output. The user types the command explicitly for their own
/// dev container; `target` is validated but the command is intentionally free.
#[tauri::command]
pub fn docker_exec(
    bin: String,
    target: String,
    command: String,
) -> Result<CommandResult, String> {
    if !valid_bin(&bin) {
        return Err(format!("unsupported container engine: {bin}"));
    }
    if target.is_empty() || target.starts_with('-') {
        return Err(format!("invalid container: {target}"));
    }
    run_docker_capture(&bin, &["exec", &target, "sh", "-c", &command], None)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(name: &str, alive: bool) -> EngineProbe {
        EngineProbe { name: name.into(), version: Some("v1".into()), alive }
    }

    #[test]
    fn choose_prefers_alive_preferred() {
        let probes = [probe("docker", true), probe("podman", true)];
        assert_eq!(choose_engine(&probes, Some("docker")).as_deref(), Some("docker"));
    }

    #[test]
    fn choose_falls_back_when_preferred_dead() {
        let probes = [probe("docker", false), probe("podman", true)];
        assert_eq!(choose_engine(&probes, Some("docker")).as_deref(), Some("podman"));
    }

    #[test]
    fn choose_returns_dead_engine_when_only_option() {
        let probes = [probe("docker", false)];
        assert_eq!(choose_engine(&probes, None).as_deref(), Some("docker"));
    }

    #[test]
    fn choose_none_when_no_engines() {
        assert_eq!(choose_engine(&[], Some("podman")), None);
    }

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
    fn first_str_handles_string_and_array() {
        // docker: string
        let dv = serde_json::json!({ "Names": "web-1" });
        assert_eq!(first_str(&dv, &["Names", "name"]), "web-1");
        // podman: array
        let pv = serde_json::json!({ "Names": ["web-1"] });
        assert_eq!(first_str(&pv, &["Names", "name"]), "web-1");
        // missing → empty
        assert_eq!(first_str(&serde_json::json!({}), &["Names"]), "");
    }

    #[test]
    fn ports_across_engines() {
        // docker: string
        let dv = serde_json::json!({ "Ports": "0.0.0.0:8080->80/tcp" });
        assert_eq!(extract_ports(&dv), "0.0.0.0:8080->80/tcp");
        // podman: ExposedPorts object
        let pv = serde_json::json!({ "Ports": null, "ExposedPorts": { "25565": ["tcp"], "8080": ["tcp"] } });
        assert_eq!(extract_ports(&pv), "25565, 8080");
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
