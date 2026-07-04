// ─── System status / process inspector ──────────────────────────────────────
// Backs the IDE's status bar and process/port inspector: machine snapshot
// (CPU/mem/swap/disks/load), top processes, listening TCP ports, and a
// guarded kill. A persistent `System` behind a mutex keeps CPU percentages
// meaningful (they are deltas between refreshes).

use std::process::Command;
use std::sync::Mutex;

use serde::Serialize;
use sysinfo::{Disks, Pid, ProcessesToUpdate, System};

static SYS: Mutex<Option<System>> = Mutex::new(None);

fn with_system<T>(f: impl FnOnce(&mut System) -> T) -> T {
    let mut guard = SYS.lock().unwrap();
    let sys = guard.get_or_insert_with(System::new);
    f(sys)
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    mount: String,
    used_bytes: u64,
    total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSnapshot {
    cpu_pct: f32,
    cpu_count: usize,
    mem_used: u64,
    mem_total: u64,
    swap_used: u64,
    swap_total: u64,
    load_avg_one: f64,
    uptime_secs: u64,
    disks: Vec<DiskInfo>,
    /// This app's own footprint.
    app_mem: u64,
    app_cpu_pct: f32,
}

#[tauri::command]
pub fn system_snapshot() -> SystemSnapshot {
    with_system(|sys| {
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        sys.refresh_processes(ProcessesToUpdate::All, true);

        let disks = Disks::new_with_refreshed_list()
            .iter()
            .filter(|d| {
                let m = d.mount_point().to_string_lossy();
                // Skip pseudo/overlay mounts; keep real filesystems.
                !m.starts_with("/proc") && !m.starts_with("/sys") && !m.starts_with("/dev")
                    && !m.starts_with("/run") && !m.contains("overlay")
            })
            .map(|d| DiskInfo {
                mount: d.mount_point().to_string_lossy().into_owned(),
                used_bytes: d.total_space().saturating_sub(d.available_space()),
                total_bytes: d.total_space(),
            })
            .collect();

        let me = sysinfo::get_current_pid().ok().and_then(|pid| sys.process(pid));

        SystemSnapshot {
            cpu_pct: sys.global_cpu_usage(),
            cpu_count: sys.cpus().len(),
            mem_used: sys.used_memory(),
            mem_total: sys.total_memory(),
            swap_used: sys.used_swap(),
            swap_total: sys.total_swap(),
            load_avg_one: System::load_average().one,
            uptime_secs: System::uptime(),
            disks,
            app_mem: me.map(|p| p.memory()).unwrap_or(0),
            app_cpu_pct: me.map(|p| p.cpu_usage()).unwrap_or(0.0),
        }
    })
}

// ─── Processes ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pid: u32,
    name: String,
    cpu_pct: f32,
    mem_bytes: u64,
    cmd: String,
    /// Owned by the current user → killable from the UI.
    is_own: bool,
}

#[tauri::command]
pub fn system_processes(sort: String, limit: usize) -> Vec<ProcInfo> {
    with_system(|sys| {
        sys.refresh_processes(ProcessesToUpdate::All, true);
        let own_uid = sysinfo::get_current_pid()
            .ok()
            .and_then(|pid| sys.process(pid))
            .and_then(|p| p.user_id().cloned());

        let mut procs: Vec<ProcInfo> = sys
            .processes()
            .iter()
            .map(|(pid, p)| ProcInfo {
                pid: pid.as_u32(),
                name: p.name().to_string_lossy().into_owned(),
                cpu_pct: p.cpu_usage(),
                mem_bytes: p.memory(),
                cmd: p
                    .cmd()
                    .iter()
                    .map(|c| c.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join(" ")
                    .chars()
                    .take(200)
                    .collect(),
                is_own: own_uid.is_some() && p.user_id() == own_uid.as_ref(),
            })
            .collect();

        if sort == "mem" {
            procs.sort_by(|a, b| b.mem_bytes.cmp(&a.mem_bytes));
        } else {
            procs.sort_by(|a, b| b.cpu_pct.partial_cmp(&a.cpu_pct).unwrap_or(std::cmp::Ordering::Equal));
        }
        procs.truncate(limit.clamp(1, 200));
        procs
    })
}

// ─── Listening ports ─────────────────────────────────────────────────────────

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    port: u16,
    pid: Option<u32>,
    process: Option<String>,
}

/// Parse `ss -tlnpH` output (Linux). Example line:
/// `LISTEN 0 511 *:3000 *:* users:(("node",pid=1234,fd=25))`
fn parse_ss(output: &str) -> Vec<PortInfo> {
    let mut out = Vec::new();
    for line in output.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 4 {
            continue;
        }
        // Local address is column 3 (0-based) in -tlnpH output.
        let local = cols[3];
        let port = local.rsplit(':').next().and_then(|p| p.parse::<u16>().ok());
        let Some(port) = port else { continue };

        let (mut pid, mut process) = (None, None);
        if let Some(users) = line.split("users:((").nth(1) {
            // ("node",pid=1234,fd=25))
            if let Some(name) = users.split('"').nth(1) {
                process = Some(name.to_string());
            }
            if let Some(p) = users.split("pid=").nth(1) {
                pid = p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().ok();
            }
        }
        out.push(PortInfo { port, pid, process });
    }
    out.sort_by_key(|p| p.port);
    out.dedup_by_key(|p| p.port);
    out
}

/// Parse `netstat -ano -p tcp` output (Windows). Example line:
/// `  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234`
fn parse_netstat(output: &str) -> Vec<PortInfo> {
    let mut out = Vec::new();
    for line in output.lines() {
        if !line.contains("LISTENING") {
            continue;
        }
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 {
            continue;
        }
        let port = cols[1].rsplit(':').next().and_then(|p| p.parse::<u16>().ok());
        let Some(port) = port else { continue };
        let pid = cols[4].parse::<u32>().ok();
        out.push(PortInfo { port, pid, process: None });
    }
    out.sort_by_key(|p| p.port);
    out.dedup_by_key(|p| p.port);
    out
}

#[tauri::command]
pub fn system_ports() -> Result<Vec<PortInfo>, String> {
    #[cfg(windows)]
    {
        let out = Command::new("netstat")
            .args(["-ano", "-p", "tcp"])
            .output()
            .map_err(|e| format!("netstat failed: {e}"))?;
        let mut ports = parse_netstat(&String::from_utf8_lossy(&out.stdout));
        // Resolve process names from the live process table.
        with_system(|sys| {
            sys.refresh_processes(ProcessesToUpdate::All, true);
            for p in &mut ports {
                if let Some(pid) = p.pid {
                    p.process = sys
                        .process(Pid::from_u32(pid))
                        .map(|pr| pr.name().to_string_lossy().into_owned());
                }
            }
        });
        Ok(ports)
    }
    #[cfg(not(windows))]
    {
        let out = Command::new("ss")
            .args(["-tlnpH"])
            .output()
            .map_err(|e| format!("ss failed: {e} (is iproute2 installed?)"))?;
        Ok(parse_ss(&String::from_utf8_lossy(&out.stdout)))
    }
}

// ─── Guarded kill ────────────────────────────────────────────────────────────

/// Kill one process. Guards: never PID ≤ 1, never processes not owned by the
/// current user, never this app itself. The frontend additionally confirms.
#[tauri::command]
pub fn system_kill(pid: u32) -> Result<(), String> {
    if pid <= 1 {
        return Err("refusing to kill PID 0/1".into());
    }
    let me = std::process::id();
    if pid == me {
        return Err("refusing to kill the IDE itself".into());
    }
    with_system(|sys| {
        sys.refresh_processes(ProcessesToUpdate::All, true);
        let own_uid = sysinfo::get_current_pid()
            .ok()
            .and_then(|p| sys.process(p))
            .and_then(|p| p.user_id().cloned());
        let Some(proc_) = sys.process(Pid::from_u32(pid)) else {
            return Err(format!("no such process: {pid}"));
        };
        if own_uid.is_none() || proc_.user_id() != own_uid.as_ref() {
            return Err("refusing to kill a process owned by another user".into());
        }
        if proc_.kill() {
            Ok(())
        } else {
            Err(format!("kill signal to {pid} failed"))
        }
    })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ss_parses_ports_pids_and_names() {
        let fixture = "\
LISTEN 0 511 *:3000 *:* users:((\"node\",pid=1234,fd=25))
LISTEN 0 128 127.0.0.1:5432 0.0.0.0:* users:((\"postgres\",pid=987,fd=7))
LISTEN 0 4096 [::1]:6379 [::]:*";
        let ports = parse_ss(fixture);
        assert_eq!(ports.len(), 3);
        assert_eq!(ports[0], PortInfo { port: 3000, pid: Some(1234), process: Some("node".into()) });
        assert_eq!(ports[1], PortInfo { port: 5432, pid: Some(987), process: Some("postgres".into()) });
        assert_eq!(ports[2], PortInfo { port: 6379, pid: None, process: None });
    }

    #[test]
    fn ss_dedupes_and_skips_junk() {
        let fixture = "\
garbage line
LISTEN 0 511 0.0.0.0:8080 0.0.0.0:* users:((\"a\",pid=1,fd=1))
LISTEN 0 511 [::]:8080 [::]:* users:((\"a\",pid=1,fd=2))";
        let ports = parse_ss(fixture);
        assert_eq!(ports.len(), 1);
        assert_eq!(ports[0].port, 8080);
    }

    #[test]
    fn netstat_parses_listening_lines() {
        let fixture = "\
  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234
  TCP    127.0.0.1:5432         0.0.0.0:0              LISTENING       987
  TCP    10.0.0.5:52344         142.250.1.1:443        ESTABLISHED     555";
        let ports = parse_netstat(fixture);
        assert_eq!(ports.len(), 2);
        assert_eq!(ports[0], PortInfo { port: 3000, pid: Some(1234), process: None });
        assert_eq!(ports[1], PortInfo { port: 5432, pid: Some(987), process: None });
    }

    #[test]
    fn kill_guards_low_pids() {
        assert!(system_kill(0).is_err());
        assert!(system_kill(1).is_err());
        assert!(system_kill(std::process::id()).is_err());
    }
}
