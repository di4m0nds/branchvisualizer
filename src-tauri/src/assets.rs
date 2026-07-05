// ─── Project asset storage ───────────────────────────────────────────────────
// Durable, project-scoped storage for app features (knowledge base, diagrams,
// goal-run state). Local projects keep assets inside the working tree at
// `<root>/.code-agent` so the agent's jailed tools — and CLI providers running
// in cwd — can read them as ordinary files. Projects without a local root
// (GitHub-source) fall back to the Tauri app-data dir. Every command is jailed
// to the asset root with the same `jail()` used by the agent fs bridge.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

use crate::fs::jail;

/// Like `fs::jail`, but for paths whose parent directories may not exist yet
/// (asset writes create nested trees like `kb/notes/<id>.md`). `fs::jail`
/// canonicalizes the direct parent, which fails when two or more levels are
/// missing. Relative targets are validated lexically instead: any `..` / root
/// component is rejected, then the path is joined onto the canonical root.
/// Absolute targets fall through to the strict `jail`.
fn jail_creatable(root: &str, target: &str) -> Result<PathBuf, String> {
    let t = Path::new(target);
    if t.is_absolute() {
        return jail(root, target);
    }
    let canon_root = Path::new(root)
        .canonicalize()
        .map_err(|e| format!("invalid root {root}: {e}"))?;
    for comp in t.components() {
        match comp {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(format!("path escapes asset root: {target}")),
        }
    }
    Ok(canon_root.join(t))
}

/// Resolve (and create) the asset root for a project. Local projects get
/// `<project_root>/.code-agent`; others `<app_data_dir>/projects/<project_id>`.
#[tauri::command]
pub fn asset_root(
    app: tauri::AppHandle,
    project_root: Option<String>,
    project_id: String,
) -> Result<String, String> {
    let dir: PathBuf = match project_root.filter(|r| !r.is_empty()) {
        Some(root) => {
            // Jail the fixed ".code-agent" segment against the project root so a
            // bogus/symlinked root can't redirect writes outside the tree.
            let canon = jail(&root, ".code-agent")?;
            canon
        }
        None => {
            if project_id.is_empty() || project_id.contains(['/', '\\', '.']) {
                return Err(format!("invalid project id: {project_id}"));
            }
            app.path()
                .app_data_dir()
                .map_err(|e| format!("no app data dir: {e}"))?
                .join("projects")
                .join(project_id)
        }
    };
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir asset root: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetEntry {
    name: String,
    path: String, // relative to the listed dir
    is_dir: bool,
    size_bytes: u64,
    modified_at: Option<u64>, // unix millis
}

/// List entries directly under `dir/subpath` (jailed to `dir`). Missing
/// directories list as empty rather than erroring, so callers don't have to
/// pre-create feature folders.
#[tauri::command]
pub fn asset_list(dir: String, subpath: String) -> Result<Vec<AssetEntry>, String> {
    let p = jail_creatable(&dir, if subpath.is_empty() { "." } else { &subpath })?;
    if !p.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&p).map_err(|e| format!("readdir {subpath}: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let meta = entry.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified_at = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        let rel = if subpath.is_empty() || subpath == "." {
            name.clone()
        } else {
            format!("{}/{}", subpath.trim_end_matches('/'), name)
        };
        out.push(AssetEntry { name, path: rel, is_dir, size_bytes, modified_at });
    }
    out.sort_by(|a, b| (!a.is_dir, a.name.to_lowercase()).cmp(&(!b.is_dir, b.name.to_lowercase())));
    Ok(out)
}

/// Read an asset file. Returns None when the file doesn't exist (callers treat
/// missing indexes as empty state, not errors).
#[tauri::command]
pub fn asset_read(dir: String, path: String) -> Result<Option<String>, String> {
    let p = jail_creatable(&dir, &path)?;
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(&p)
        .map(Some)
        .map_err(|e| format!("read {path}: {e}"))
}

/// Write (create/overwrite) an asset file, creating parent dirs.
#[tauri::command]
pub fn asset_write(dir: String, path: String, content: String) -> Result<(), String> {
    let p = jail_creatable(&dir, &path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {path}: {e}"))?;
    }
    fs::write(&p, content).map_err(|e| format!("write {path}: {e}"))
}

/// Delete an asset file or directory (recursive).
#[tauri::command]
pub fn asset_delete(dir: String, path: String) -> Result<(), String> {
    let p = jail_creatable(&dir, &path)?;
    if !p.exists() {
        return Ok(());
    }
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| format!("rmdir {path}: {e}"))
    } else {
        fs::remove_file(&p).map_err(|e| format!("rm {path}: {e}"))
    }
}

/// Rename/move within the asset root (both ends jailed).
#[tauri::command]
pub fn asset_rename(dir: String, from: String, to: String) -> Result<(), String> {
    let src = jail_creatable(&dir, &from)?;
    let dst = jail_creatable(&dir, &to)?;
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {to}: {e}"))?;
    }
    fs::rename(&src, &dst).map_err(|e| format!("rename {from} -> {to}: {e}"))
}

/// Copy a user-dialog-picked absolute file INTO the asset root. The source is
/// NOT jailed — like `read_attachment`, the path comes from the native file
/// dialog (an explicit user choice). The destination is jailed. Size-capped.
const IMPORT_MAX_BYTES: u64 = 16 * 1024 * 1024;

#[tauri::command]
pub fn asset_import(dir: String, src_abs_path: String, dest: String) -> Result<(), String> {
    let src = PathBuf::from(&src_abs_path);
    let meta = fs::metadata(&src).map_err(|e| format!("stat {src_abs_path}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("not a file: {src_abs_path}"));
    }
    if meta.len() > IMPORT_MAX_BYTES {
        return Err(format!(
            "file is {} bytes — exceeds the {IMPORT_MAX_BYTES} byte import limit",
            meta.len()
        ));
    }
    let dst = jail_creatable(&dir, &dest)?;
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {dest}: {e}"))?;
    }
    fs::copy(&src, &dst).map_err(|e| format!("copy {src_abs_path}: {e}"))?;
    Ok(())
}

/// Export content to a user-dialog-picked absolute path (save dialog). NOT
/// jailed — explicit user choice, mirrors `read_attachment`'s justification.
/// `base64` payloads support binary exports (PNG); plain text otherwise.
#[tauri::command]
pub fn write_export(dest_abs_path: String, content: String, base64: bool) -> Result<(), String> {
    let p = PathBuf::from(&dest_abs_path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {dest_abs_path}: {e}"))?;
    }
    if base64 {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(content.as_bytes())
            .map_err(|e| format!("bad base64: {e}"))?;
        fs::write(&p, bytes).map_err(|e| format!("write {dest_abs_path}: {e}"))
    } else {
        fs::write(&p, content).map_err(|e| format!("write {dest_abs_path}: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    fn tmp_root(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("codeagent_assets_{}_{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn write_read_roundtrip_and_missing_is_none() {
        let root = tmp_root("rw");
        let dir = root.to_str().unwrap().to_string();
        super::asset_write(dir.clone(), "kb/notes/a.md".into(), "hello".into()).unwrap();
        assert_eq!(super::asset_read(dir.clone(), "kb/notes/a.md".into()).unwrap(), Some("hello".into()));
        assert_eq!(super::asset_read(dir, "kb/notes/missing.md".into()).unwrap(), None);
    }

    #[test]
    fn list_missing_dir_is_empty_and_sorted() {
        let root = tmp_root("ls");
        let dir = root.to_str().unwrap().to_string();
        assert!(super::asset_list(dir.clone(), "nope".into()).unwrap().is_empty());
        super::asset_write(dir.clone(), "kb/b.md".into(), "b".into()).unwrap();
        super::asset_write(dir.clone(), "kb/a.md".into(), "a".into()).unwrap();
        fs::create_dir_all(root.join("kb/sub")).unwrap();
        let entries = super::asset_list(dir, "kb".into()).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["sub", "a.md", "b.md"]);
        assert_eq!(entries[1].path, "kb/a.md");
    }

    #[test]
    fn jail_blocks_escape_in_every_command() {
        let root = tmp_root("jail");
        let dir = root.to_str().unwrap().to_string();
        assert!(super::asset_write(dir.clone(), "../evil.md".into(), "x".into()).is_err());
        assert!(super::asset_read(dir.clone(), "/etc/passwd".into()).is_err());
        assert!(super::asset_delete(dir.clone(), "../..".into()).is_err());
        assert!(super::asset_rename(dir.clone(), "a".into(), "../b".into()).is_err());
        assert!(super::asset_import(dir, "/etc/hostname".into(), "../x".into()).is_err());
    }

    #[test]
    fn rename_and_delete() {
        let root = tmp_root("mv");
        let dir = root.to_str().unwrap().to_string();
        super::asset_write(dir.clone(), "a.md".into(), "x".into()).unwrap();
        super::asset_rename(dir.clone(), "a.md".into(), "sub/b.md".into()).unwrap();
        assert_eq!(super::asset_read(dir.clone(), "sub/b.md".into()).unwrap(), Some("x".into()));
        super::asset_delete(dir.clone(), "sub".into()).unwrap();
        assert_eq!(super::asset_read(dir, "sub/b.md".into()).unwrap(), None);
    }
}
