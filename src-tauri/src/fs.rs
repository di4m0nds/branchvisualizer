// ─── Agent filesystem / exec bridge ─────────────────────────────────────────
// Backs the agent's dedicated tools (read_file, write_file, list_dir, grep,
// run_command). Every path is jailed to the session's `root` in Rust — the model
// cannot escape the working tree even under prompt injection. This is the
// security boundary; the access-level gating in the frontend loop is layered on
// top of it.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

/// Resolve `target` against `root` and reject anything that escapes the jail.
/// `target` may be absolute (must still be inside root) or relative to root.
/// Shared with assets.rs / exec.rs so every project-scoped surface enforces
/// the same boundary.
pub(crate) fn jail(root: &str, target: &str) -> Result<PathBuf, String> {
    let root_path = Path::new(root);
    let canon_root = root_path
        .canonicalize()
        .map_err(|e| format!("invalid root {root}: {e}"))?;

    let joined = if Path::new(target).is_absolute() {
        PathBuf::from(target)
    } else {
        canon_root.join(target)
    };

    // Canonicalize the parent for non-existent files (writes); fall back to the
    // lexical join when the parent doesn't exist yet either.
    let resolved = match joined.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            let parent = joined.parent().unwrap_or(&canon_root);
            let canon_parent = parent
                .canonicalize()
                .map_err(|e| format!("invalid path {target}: {e}"))?;
            canon_parent.join(joined.file_name().unwrap_or_default())
        }
    };

    if !resolved.starts_with(&canon_root) {
        return Err(format!("path escapes project root: {target}"));
    }
    Ok(resolved)
}

/// Read a file (jailed to root).
#[tauri::command]
pub fn agent_read_file(root: String, path: String) -> Result<String, String> {
    let p = jail(&root, &path)?;
    fs::read_to_string(&p).map_err(|e| format!("read {path}: {e}"))
}

/// Write (create/overwrite) a file (jailed to root).
#[tauri::command]
pub fn agent_write_file(root: String, path: String, content: String) -> Result<(), String> {
    let p = jail(&root, &path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {path}: {e}"))?;
    }
    fs::write(&p, content).map_err(|e| format!("write {path}: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    is_dir: bool,
}

/// List a directory (jailed to root).
#[tauri::command]
pub fn agent_list_dir(root: String, path: String) -> Result<Vec<DirEntry>, String> {
    let p = jail(&root, &path)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&p).map_err(|e| format!("readdir {path}: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(DirEntry { name, is_dir });
    }
    out.sort_by(|a, b| (b.is_dir, &a.name).cmp(&(a.is_dir, &b.name)));
    Ok(out)
}

/// Per-file match cap (mirrors the old `grep --max-count=200`).
const GREP_MAX_PER_FILE: usize = 200;
/// Global output cap so a pathological pattern can't flood the tool result.
const GREP_MAX_TOTAL: usize = 2000;

/// Grep (regex) within root. Pure Rust (`ignore` walk + `regex`) so it works
/// identically on every OS with no external `grep` dependency, respects
/// .gitignore, and skips hidden/binary files. Output format matches the old
/// `grep -rInE`: `path:lineno:line`.
#[tauri::command]
pub fn agent_grep(root: String, pattern: String, path: Option<String>) -> Result<String, String> {
    let search_root = jail(&root, &path.unwrap_or_else(|| ".".to_string()))?;
    let re = regex::Regex::new(&pattern).map_err(|e| format!("invalid pattern: {e}"))?;

    let mut out = String::new();
    let mut total = 0usize;

    let walker = ignore::WalkBuilder::new(&search_root).build();
    for entry in walker.flatten() {
        if total >= GREP_MAX_TOTAL {
            break;
        }
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let file_path = entry.path();
        let Ok(bytes) = fs::read(file_path) else { continue };
        // Binary-file skip (grep -I): NUL byte in the first 8 KiB.
        if bytes[..bytes.len().min(8192)].contains(&0) {
            continue;
        }
        let content = String::from_utf8_lossy(&bytes);
        let mut per_file = 0usize;
        for (lineno, line) in content.lines().enumerate() {
            if re.is_match(line) {
                out.push_str(&format!("{}:{}:{}\n", file_path.display(), lineno + 1, line));
                per_file += 1;
                total += 1;
                if per_file >= GREP_MAX_PER_FILE || total >= GREP_MAX_TOTAL {
                    break;
                }
            }
        }
    }
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    stdout: String,
    stderr: String,
    code: Option<i32>,
}

/// Run a one-shot command in root, capturing output. Distinct from the PTY
/// (which is for interactive terminals) — tool results need captured output.
/// Windows gets `cmd /C` (the closest one-shot equivalent of `sh -c`).
#[tauri::command]
pub fn agent_run_command(root: String, command: String) -> Result<CommandResult, String> {
    let cwd = jail(&root, ".")?;
    #[cfg(windows)]
    let output = Command::new("cmd")
        .args(["/C", &command])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("spawn failed: {e}"))?;
    #[cfg(not(windows))]
    let output = Command::new("sh")
        .arg("-c")
        .arg(&command)
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("spawn failed: {e}"))?;
    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        code: output.status.code(),
    })
}

/// Return the API key for a given provider from the environment. Keyed lookup
/// so the frontend transports don't hardcode env-var names. Returns None when
/// the var is missing/empty.
#[tauri::command]
pub fn get_provider_key(name: String) -> Option<String> {
    let vars: &[&str] = match name.as_str() {
        "anthropic" => &["ANTHROPIC_API_KEY"],
        "claude_code" => &["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"],
        "openai" | "openai_codex" => &["OPENAI_API_KEY", "CODEX_API_KEY"],
        "gemini" | "antigravity" => &["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        "minimax" => &["MINIMAX_API_KEY"],
        "opencode" => &["OPENCODE_API_KEY"],
        "openrouter" => &["OPENROUTER_API_KEY"],
        "xai" => &["XAI_API_KEY", "GROK_API_KEY"],
        "deepseek" => &["DEEPSEEK_API_KEY"],
        _ => &[],
    };
    for v in vars {
        if let Ok(val) = std::env::var(v) {
            if !val.is_empty() {
                return Some(val);
            }
        }
    }
    None
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProbe {
    detected: bool,
    connected: bool,
    version: Option<String>,
    auth_kind: Option<String>,
    error: Option<String>,
}

/// Probe a CLI-based provider (codex / opencode). Uses a strict allow-list so
/// the model can't drive `check_cli_provider` into arbitrary shells.
#[tauri::command]
pub fn check_cli_provider(name: String) -> Result<CliProbe, String> {
    let binary = match name.as_str() {
        "codex" => "codex",
        "opencode" => "opencode",
        "claude" | "claude_code" => "claude",
        other => return Err(format!("unknown CLI provider: {other}")),
    };

    // Detected?
    let version_out = run_cli(binary, &["--version"]);
    let detected = version_out.as_ref().map(|o| o.status.success()).unwrap_or(false);
    let version = version_out
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

    if !detected {
        return Ok(CliProbe {
            detected: false,
            connected: false,
            version,
            auth_kind: None,
            error: Some(format!("{binary} not on PATH")),
        });
    }

    // Connected? Codex has no `auth status` subcommand (only `login`/`logout`),
    // so we rely on the on-disk credential files. OpenCode DOES have `auth list`
    // but the JSON is what actually matters — either way, prefer file presence.
    // Paths are XDG-default; we probe a small candidate list per provider.
    let (candidate_paths, list_args): (&[&str], Option<&[&str]>) = match name.as_str() {
        "codex" => (&[".codex/auth.json"], None),
        "opencode" => (
            &[".local/share/opencode/auth.json", ".opencode/auth.json"],
            Some(&["auth", "list"]),
        ),
        "claude" | "claude_code" => (
            &[".claude/.credentials.json", ".config/claude/.credentials.json"],
            None,
        ),
        _ => (&[], None),
    };

    // Optional CLI list probe (opencode); ignore its exit code — we only surface
    // the error if the file check *also* misses.
    let cli_err = list_args
        .and_then(|args| run_cli(binary, args).ok())
        .and_then(|o| if o.status.success() { None } else {
            Some(String::from_utf8_lossy(&o.stderr).trim().to_string())
        });

    let home = dirs_home();
    let matched_auth_path = candidate_paths.iter().find_map(|rel| {
        home.as_ref().and_then(|h| {
            let p = h.join(rel);
            if p.exists() { Some(p) } else { None }
        })
    });

    let mut connected = matched_auth_path.is_some();
    let mut auth_kind = matched_auth_path
        .as_ref()
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|s| {
            if s.contains("chatgpt") || s.contains("oauth") || s.contains("refresh_token") {
                "oauth".to_string()
            } else if s.contains("api_key") || s.contains("apiKey") {
                "apikey".to_string()
            } else {
                "unknown".to_string()
            }
        });

    // Claude Code can authenticate purely from the environment (a
    // `claude setup-token` OAuth token, or a plain API key) with no credential
    // file present. Count that as connected.
    if matches!(name.as_str(), "claude" | "claude_code") && !connected {
        let has = |k: &str| std::env::var(k).ok().filter(|s| !s.is_empty()).is_some();
        if has("CLAUDE_CODE_OAUTH_TOKEN") || has("ANTHROPIC_AUTH_TOKEN") {
            connected = true;
            auth_kind = Some("oauth".to_string());
        } else if has("ANTHROPIC_API_KEY") {
            connected = true;
            auth_kind = Some("apikey".to_string());
        }
    }

    Ok(CliProbe {
        detected,
        connected,
        version,
        auth_kind,
        error: if connected { None } else { cli_err },
    })
}

/// The user's home directory: `HOME` (Unix, and respected if set on Windows),
/// falling back to `USERPROFILE` (Windows). Shared with pty.rs so credential
/// probes like `~/.claude/...` resolve to `%USERPROFILE%\.claude\...` too.
pub(crate) fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|v| !v.is_empty())
        .or_else(|| std::env::var_os("USERPROFILE").filter(|v| !v.is_empty()))
        .map(PathBuf::from)
}

fn dirs_home() -> Option<PathBuf> {
    home_dir()
}

/// Spawn an allow-listed CLI and capture output. On Windows, npm-installed
/// CLIs are `.cmd` shims that CreateProcess won't resolve via `Command::new`,
/// so a NotFound error retries through `cmd /C`.
fn run_cli(binary: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
    let direct = Command::new(binary).args(args).output();
    #[cfg(windows)]
    if matches!(&direct, Err(e) if e.kind() == std::io::ErrorKind::NotFound) {
        let mut all = vec![binary];
        all.extend_from_slice(args);
        return Command::new("cmd").arg("/C").args(&all).output();
    }
    direct
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    ok: bool,
    /// Combined stdout+stderr, trimmed — surfaced in the UI so the user sees
    /// exactly what the updater did.
    output: String,
    /// The command that ran (for display).
    command: String,
}

/// Self-update a provider's local toolchain. Strict allow-list so the model /
/// UI can't drive this into an arbitrary shell:
///   claude / claude_code → `claude update`
///   antigravity          → `python3 -m pip install --upgrade google-antigravity`
#[tauri::command]
pub fn provider_update(name: String) -> Result<UpdateResult, String> {
    // Windows installs CPython as `python`; `python3` is the Unix name.
    let python = if cfg!(windows) { "python" } else { "python3" };
    let (bin, args): (&str, Vec<&str>) = match name.as_str() {
        "claude" | "claude_code" => ("claude", vec!["update"]),
        "antigravity" => (
            python,
            vec!["-m", "pip", "install", "--upgrade", "google-antigravity"],
        ),
        other => return Err(format!("provider `{other}` has no update command")),
    };

    let command = format!("{bin} {}", args.join(" "));
    let out = run_cli(bin, &args)
        .map_err(|e| format!("failed to run `{command}`: {e}"))?;

    let mut output = String::from_utf8_lossy(&out.stdout).into_owned();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str(&err);
    }

    Ok(UpdateResult {
        ok: out.status.success(),
        output: output.trim().to_string(),
        command,
    })
}

// ─── Filesystem walk (for the local Files / Docs tabs) ──────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    path: String,       // relative to root
    name: String,
    is_dir: bool,
    size_bytes: u64,
    depth: u32,
}

/// Cap so a giant monorepo can't lock up the renderer. Front-end can paginate
/// or drill down into subtrees via a smaller root.
const WALK_MAX_ENTRIES: usize = 5000;

const DEFAULT_IGNORE: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", ".venv",
    "__pycache__", ".next", ".turbo", ".cache",
];

/// Walk the tree under `root`, jailed. Skips a common ignore list and dot-dirs.
/// `max_depth` bounds recursion (0 = unlimited).
///
/// Emits entries in depth-first pre-order — each directory is immediately
/// followed by its descendants — with siblings sorted (dirs first, alpha
/// within). A global sort would scatter a directory's files away from the
/// directory, breaking the front-end's nesting (which relies on parents being
/// contiguous with their children).
#[tauri::command]
pub fn walk_tree(root: String, max_depth: Option<u32>) -> Result<Vec<TreeEntry>, String> {
    let base = jail(&root, ".")?;
    let max = max_depth.unwrap_or(0);
    let mut out: Vec<TreeEntry> = Vec::new();
    walk_dir_ordered(&base, &base, 0, max, &mut out);
    Ok(out)
}

/// Recursive DFS helper: reads one directory, sorts its siblings, and emits each
/// entry followed by its subtree.
fn walk_dir_ordered(dir: &Path, base: &Path, depth: u32, max: u32, out: &mut Vec<TreeEntry>) {
    if out.len() >= WALK_MAX_ENTRIES {
        return;
    }
    let read = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    // Collect this directory's visible children before sorting.
    let mut siblings: Vec<(PathBuf, String, bool, u64)> = Vec::new();
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if DEFAULT_IGNORE.contains(&name.as_str()) {
            continue;
        }
        // Skip hidden entries only at the top level; keep e.g. `.cargo` visible
        // when the user drills down explicitly.
        if name.starts_with('.') && depth == 0 {
            continue;
        }
        let full = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        siblings.push((full, name, is_dir, size_bytes));
    }

    // Siblings only: directories first, then files, case-insensitive alpha.
    siblings.sort_by(|a, b| {
        (!a.2, a.1.to_lowercase()).cmp(&(!b.2, b.1.to_lowercase()))
    });

    for (full, name, is_dir, size_bytes) in siblings {
        if out.len() >= WALK_MAX_ENTRIES {
            break;
        }
        let rel = full
            .strip_prefix(base)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| name.clone());
        out.push(TreeEntry {
            path: rel,
            name,
            is_dir,
            size_bytes,
            depth,
        });
        if is_dir && (max == 0 || depth + 1 < max) {
            walk_dir_ordered(&full, base, depth + 1, max, out);
        }
    }
}

/// Read a file as base64 (for PDF / docx viewers). Jailed.
#[tauri::command]
pub fn agent_read_file_bytes(root: String, path: String) -> Result<String, String> {
    let p = jail(&root, &path)?;
    let bytes = fs::read(&p).map_err(|e| format!("read {path}: {e}"))?;
    Ok(base64_of(&bytes))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentData {
    base64: String,
    size_bytes: u64,
    mime: String,
}

/// Read a user-picked attachment (chat composer). NOT jailed — the path comes
/// from the native file dialog, i.e. an explicit user choice, and may live
/// anywhere. Size-capped so a mis-pick can't balloon memory.
#[tauri::command]
pub fn read_attachment(path: String, max_bytes: u64) -> Result<AttachmentData, String> {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| format!("stat {path}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("not a file: {path}"));
    }
    if meta.len() > max_bytes {
        return Err(format!(
            "file is {} bytes — exceeds the {} byte attachment limit",
            meta.len(), max_bytes
        ));
    }
    let bytes = fs::read(&p).map_err(|e| format!("read {path}: {e}"))?;
    let mime = match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    };
    Ok(AttachmentData {
        base64: base64_of(&bytes),
        size_bytes: meta.len(),
        mime: mime.to_string(),
    })
}

fn base64_of(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::jail;
    use std::fs;

    // Unique temp dir per test process; created fresh so canonicalize() resolves.
    fn tmp_root() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("codeagent_jail_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn allows_paths_inside_root() {
        let root = tmp_root();
        let root_str = root.to_str().unwrap();
        // A new file directly in root resolves (parent — root — exists).
        let p = jail(root_str, "file.txt").expect("in-jail path should resolve");
        assert!(p.starts_with(&root));
        // A file in an existing subdir also resolves.
        fs::create_dir_all(root.join("sub")).unwrap();
        let q = jail(root_str, "sub/file.txt").expect("in-jail nested path should resolve");
        assert!(q.starts_with(&root));
    }

    #[test]
    fn rejects_parent_escape() {
        let root = tmp_root();
        let root_str = root.to_str().unwrap();
        assert!(jail(root_str, "../../etc/passwd").is_err());
        assert!(jail(root_str, "/etc/passwd").is_err());
    }

    // ── agent_grep (pure-Rust) ───────────────────────────────────────────────

    fn grep_fixture(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("codeagent_grep_{}_{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn grep_matches_with_path_line_format() {
        let root = grep_fixture("fmt");
        fs::write(root.join("a.txt"), "alpha\nneedle here\nomega\n").unwrap();
        fs::write(root.join("b.txt"), "nothing\n").unwrap();
        let out = super::agent_grep(root.to_str().unwrap().into(), "needle".into(), None).unwrap();
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].ends_with(":2:needle here"), "got: {}", lines[0]);
        assert!(lines[0].contains("a.txt"));
    }

    #[test]
    fn grep_invalid_pattern_errors_and_no_match_is_empty() {
        let root = grep_fixture("err");
        fs::write(root.join("a.txt"), "text\n").unwrap();
        assert!(super::agent_grep(root.to_str().unwrap().into(), "(".into(), None).is_err());
        let out = super::agent_grep(root.to_str().unwrap().into(), "zzz_no_match".into(), None).unwrap();
        assert_eq!(out, "");
    }

    #[test]
    fn grep_skips_binary_and_respects_gitignore() {
        let root = grep_fixture("skip");
        fs::write(root.join("bin.dat"), b"needle\x00binary").unwrap();
        fs::write(root.join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(root.join("ignored.txt"), "needle ignored\n").unwrap();
        fs::write(root.join("kept.txt"), "needle kept\n").unwrap();
        // `ignore` only applies .gitignore inside a git repo — mark it as one.
        fs::create_dir_all(root.join(".git")).unwrap();
        let out = super::agent_grep(root.to_str().unwrap().into(), "needle".into(), None).unwrap();
        assert!(out.contains("kept.txt"), "got: {out}");
        assert!(!out.contains("ignored.txt"), "got: {out}");
        assert!(!out.contains("bin.dat"), "got: {out}");
    }

    #[test]
    fn grep_caps_per_file_matches() {
        let root = grep_fixture("cap");
        let many = "needle\n".repeat(500);
        fs::write(root.join("many.txt"), many).unwrap();
        let out = super::agent_grep(root.to_str().unwrap().into(), "needle".into(), None).unwrap();
        assert_eq!(out.lines().count(), super::GREP_MAX_PER_FILE);
    }

    #[test]
    fn home_dir_resolves() {
        // On any dev/CI machine one of HOME/USERPROFILE is set.
        assert!(super::home_dir().is_some());
    }
}
