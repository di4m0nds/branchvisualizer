// ─── Podman agent-runtime sandbox ────────────────────────────────────────────
// Opt-in per session: the agent's `run_command` executes inside a rootless
// Podman container instead of on the host. The session root is bind-mounted at
// the SAME absolute path (`-v root:root`) so paths in tool output stay
// consistent with the host-side file tools; `--userns=keep-id` keeps created
// files owned by the user. One container per project root, named
// `ca-sbx-<fnv1a(root)>`, reused across sessions on that root, removed on
// session close / app exit.
//
// Reuses docker.rs's validated plumbing (arg-vector spawning, allow-listed
// engine, `runtime://` streaming) — podman-only for the MVP.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::docker::{run_docker, run_docker_capture, spawn_stream, valid_bin, CommandResult};

pub const SANDBOX_IMAGE: &str = "code-agent-sandbox:latest";

// ─── Naming / validation ─────────────────────────────────────────────────────

/// Deterministic container name for a project root (FNV-1a over the canonical
/// path — std's DefaultHasher isn't guaranteed stable across runs).
fn container_name(canonical_root: &str) -> String {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;
    let mut hash = FNV_OFFSET;
    for b in canonical_root.as_bytes() {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("ca-sbx-{hash:016x}")
}

fn valid_name(name: &str) -> bool {
    name.strip_prefix("ca-sbx-")
        .map(|hex| !hex.is_empty() && hex.chars().all(|c| c.is_ascii_hexdigit()))
        .unwrap_or(false)
}

/// Canonicalize + validate the project root (reuses the fs jail).
fn canonical_root(root: &str) -> Result<String, String> {
    let p: PathBuf = std::path::Path::new(root)
        .canonicalize()
        .map_err(|e| format!("invalid sandbox root {root}: {e}"))?;
    if !p.is_dir() {
        return Err(format!("sandbox root is not a directory: {root}"));
    }
    Ok(p.to_string_lossy().into_owned())
}

// ─── Lifecycle tracking (for teardown on exit) ───────────────────────────────

static CREATED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
fn created() -> &'static Mutex<HashSet<String>> {
    CREATED.get_or_init(|| Mutex::new(HashSet::new()))
}

// ─── Commands ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxStatus {
    engine_ok: bool,
    engine_version: Option<String>,
    image_ready: bool,
}

/// Probe: is podman available and is the sandbox image built?
#[tauri::command]
pub fn sandbox_status(bin: String) -> Result<SandboxStatus, String> {
    if !valid_bin(&bin) {
        return Err(format!("unsupported container engine: {bin}"));
    }
    let engine_version = run_docker(&bin, &["--version"], None)
        .ok()
        .map(|v| v.trim().to_string());
    let image_ready = engine_version.is_some()
        && run_docker(&bin, &["image", "exists", SANDBOX_IMAGE], None).is_ok();
    Ok(SandboxStatus {
        engine_ok: engine_version.is_some(),
        engine_version,
        image_ready,
    })
}

/// Locate the bundled Containerfile directory: the bundled resource in a
/// packaged app, the repo's `containers/sandbox/` in dev.
fn sandbox_build_dir(app: &AppHandle) -> Result<String, String> {
    if let Ok(res) = app.path().resource_dir() {
        let bundled = res.join("containers").join("sandbox");
        if bundled.join("Containerfile").is_file() {
            return Ok(bundled.to_string_lossy().into_owned());
        }
    }
    // Dev fallback: repo layout relative to src-tauri.
    let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("containers")
        .join("sandbox");
    if dev.join("Containerfile").is_file() {
        return Ok(dev.to_string_lossy().into_owned());
    }
    Err("sandbox Containerfile not found (containers/sandbox/Containerfile)".into())
}

/// Build the sandbox image, streaming output over the existing `runtime://`
/// channel (`runtime://data/<id>` lines + `runtime://exit`).
#[tauri::command]
pub fn sandbox_build(app: AppHandle, id: String, bin: String) -> Result<(), String> {
    let dir = sandbox_build_dir(&app)?;
    spawn_stream(
        app,
        id,
        &bin,
        vec![
            "build".into(),
            "-t".into(),
            SANDBOX_IMAGE.into(),
            "-f".into(),
            "Containerfile".into(),
            ".".into(),
        ],
        Some(dir),
    )
}

/// Ensure the sandbox container for `root` exists and is running; returns its
/// name. Idempotent and cheap after the first call.
#[tauri::command]
pub fn sandbox_ensure(bin: String, root: String, network: bool) -> Result<String, String> {
    if !valid_bin(&bin) {
        return Err(format!("unsupported container engine: {bin}"));
    }
    let canon = canonical_root(&root)?;
    let name = container_name(&canon);

    // Existing container? Start it if stopped.
    if let Ok(state) = run_docker(
        &bin,
        &["container", "inspect", "--format", "{{.State.Status}}", &name],
        None,
    ) {
        if state.trim() != "running" {
            run_docker(&bin, &["start", &name], None)?;
        }
        created().lock().unwrap().insert(name.clone());
        return Ok(name);
    }

    // Fresh container. Same-path bind mount so tool-output paths match the
    // host; :Z relabels for SELinux (no-op elsewhere); keep-id maps the user so
    // files created inside are owned by them; conservative resource limits.
    let volume = format!("{canon}:{canon}:Z");
    let mut args: Vec<&str> = vec![
        "run", "-d",
        "--name", &name,
        "--userns=keep-id",
        "--memory", "4g",
        "--cpus", "2",
        "--pids-limit", "512",
        "--security-opt", "no-new-privileges",
        "-v", &volume,
        "-w", &canon,
    ];
    if !network {
        args.extend_from_slice(&["--network", "none"]);
    }
    args.extend_from_slice(&[SANDBOX_IMAGE, "sleep", "infinity"]);

    run_docker(&bin, &args, None).map_err(|e| {
        if e.contains("no such image") || e.contains("image not known") {
            format!("sandbox image not built yet — build it from the session bar (or `podman build -t {SANDBOX_IMAGE} containers/sandbox`). Underlying error: {e}")
        } else {
            e
        }
    })?;
    created().lock().unwrap().insert(name.clone());
    Ok(name)
}

/// Run one agent command inside the sandbox, capturing output. Mirrors
/// fs.rs::agent_run_command but executes via `podman exec` in the same
/// absolute working directory.
#[tauri::command]
pub fn sandbox_exec(
    bin: String,
    name: String,
    root: String,
    command: String,
) -> Result<CommandResult, String> {
    if !valid_bin(&bin) {
        return Err(format!("unsupported container engine: {bin}"));
    }
    if !valid_name(&name) {
        return Err(format!("invalid sandbox container name: {name}"));
    }
    let canon = canonical_root(&root)?;
    run_docker_capture(
        &bin,
        &["exec", "-w", &canon, &name, "sh", "-lc", &command],
        None,
    )
}

/// Remove one sandbox container (session close). Accepts either the container
/// `name` or the project `root` (name derived from the canonical path, same as
/// sandbox_ensure). Best-effort.
#[tauri::command]
pub fn sandbox_teardown(
    bin: String,
    name: Option<String>,
    root: Option<String>,
) -> Result<(), String> {
    if !valid_bin(&bin) {
        return Err(format!("unsupported container engine: {bin}"));
    }
    let name = match (name, root) {
        (Some(n), _) => n,
        (None, Some(r)) => container_name(&canonical_root(&r)?),
        (None, None) => return Err("sandbox_teardown needs a name or a root".into()),
    };
    if !valid_name(&name) {
        return Err(format!("invalid sandbox container name: {name}"));
    }
    let _ = run_docker(&bin, &["rm", "-f", &name], None);
    created().lock().unwrap().remove(&name);
    Ok(())
}

/// Remove every sandbox container created this run. Called on app exit.
pub fn teardown_all() {
    let names: Vec<String> = created().lock().unwrap().drain().collect();
    for name in names {
        let _ = run_docker("podman", &["rm", "-f", &name], None);
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_deterministic_and_valid() {
        let a = container_name("/home/user/project");
        let b = container_name("/home/user/project");
        let c = container_name("/home/user/other");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(valid_name(&a), "{a}");
    }

    #[test]
    fn name_validation_rejects_injection() {
        assert!(valid_name("ca-sbx-0123456789abcdef"));
        assert!(!valid_name("ca-sbx-"));
        assert!(!valid_name("ca-sbx-XYZ"));
        assert!(!valid_name("evil"));
        assert!(!valid_name("ca-sbx-abc; rm -rf /"));
        assert!(!valid_name("--privileged"));
    }

    #[test]
    fn canonical_root_rejects_missing_paths() {
        assert!(canonical_root("/definitely/not/a/real/path").is_err());
    }
}
