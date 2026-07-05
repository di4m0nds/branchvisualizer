// ─── Project command streamer ────────────────────────────────────────────────
// Backs the developer command panel: runs one shell command with its cwd
// jailed to the project root, streaming stdout and stderr line-by-line as
// `exec://data/<id>` events (payload distinguishes the stream so the UI can
// tint stderr), then `exec://exit` with the status code. Generalizes the
// docker.rs spawn_stream pattern; NOT a PTY (per-line error classification
// needs clean lines, not ANSI soup) and NOT agent_run_command (which blocks
// until completion with no streaming or cancel).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::fs::jail;

type ChildMap = Mutex<HashMap<String, Child>>;
static CHILDREN: OnceLock<ChildMap> = OnceLock::new();

fn children() -> &'static ChildMap {
    CHILDREN.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Kill a spawned command and its entire process group / tree, then reap it.
/// A bare `child.kill()` only reaches the `sh`/`cmd` wrapper, leaving real
/// servers (grandchildren) running — which is why the Stop button "did nothing".
fn kill_tree(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        // Negative pid → the whole process group (pgid == child pid, set via
        // process_group(0) at spawn). SIGTERM for a clean stop, then SIGKILL.
        let pgid = child.id() as i32;
        libc::kill(-pgid, libc::SIGTERM);
        libc::kill(-pgid, libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        // /T kills the tree, /F forces it.
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .and_then(|mut c| c.wait());
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DataPayload {
    stream: &'static str, // "out" | "err"
    line: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExitPayload {
    id: String,
    code: Option<i32>,
}

fn pump<R: Read + Send + 'static>(
    app: AppHandle,
    event: String,
    stream: &'static str,
    reader: R,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let buf = BufReader::new(reader);
        for line in buf.lines() {
            match line {
                Ok(l) => {
                    if app.emit(&event, DataPayload { stream, line: l }).is_err() {
                        break; // webview gone
                    }
                }
                Err(_) => break,
            }
        }
    })
}

/// Run `command` (via `sh -c` / `cmd /C`) with cwd jailed to `root`, streaming
/// both output channels. One live child per `id` — reusing an id kills the
/// stale process first (mirrors the PTY guard).
#[tauri::command]
pub fn exec_stream(
    app: AppHandle,
    id: String,
    root: String,
    command: String,
) -> Result<(), String> {
    let cwd = jail(&root, ".")?;

    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", &command]);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.arg("-c").arg(&command);
        c
    };

    cmd.current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    // Put the child in its own process group so cancelling kills the whole
    // tree, not just the `sh`/`cmd` wrapper (dev servers are grandchildren).
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0); // new pgid == child pid
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let stdout = child.stdout.take().ok_or("failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("failed to capture stderr")?;

    if let Some(mut old) = children().lock().unwrap().insert(id.clone(), child) {
        kill_tree(&mut old);
    }

    let data_event = format!("exec://data/{id}");
    let out_pump = pump(app.clone(), data_event.clone(), "out", stdout);
    let err_pump = pump(app.clone(), data_event, "err", stderr);

    let exit_id = id;
    thread::spawn(move || {
        // Both channels must drain before the exit event, or tail lines race it.
        let _ = out_pump.join();
        let _ = err_pump.join();
        let code = {
            let mut opt = children().lock().unwrap().remove(&exit_id);
            opt.as_mut().and_then(|c| c.wait().ok().and_then(|s| s.code()))
        };
        let _ = app.emit("exec://exit", ExitPayload { id: exit_id, code });
    });

    Ok(())
}

/// Cancel a running command.
#[tauri::command]
pub fn exec_kill(id: String) -> Result<(), String> {
    if let Some(mut child) = children().lock().unwrap().remove(&id) {
        kill_tree(&mut child);
    }
    Ok(())
}

/// Exit-time reaper (registered in lib.rs alongside the other subsystems).
pub fn kill_all_children() {
    if let Some(map) = CHILDREN.get() {
        let mut guard = map.lock().unwrap();
        for (_, mut child) in guard.drain() {
            kill_tree(&mut child);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    #[test]
    fn exec_jail_rejects_bad_root() {
        // The jail is enforced before any spawn: a nonexistent root errors.
        let missing = std::env::temp_dir().join("codeagent_exec_missing_root_zzz");
        let _ = fs::remove_dir_all(&missing);
        let err = crate::fs::jail(missing.to_str().unwrap(), ".");
        assert!(err.is_err());
    }
}
