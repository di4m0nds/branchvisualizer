// ─── Local git bridge ──────────────────────────────────────────────────────
// Shells out to the `git` binary and parses porcelain output into structs whose
// serde JSON shape matches the frontend `Commit` / `Branch` / `Tag` / `RepoInfo`
// types. This is the local analog of the GitHub REST adapter (`src/lib/github.ts`)
// and feeds the same, unchanged `buildGraphData` layout engine.
//
// We shell out to `git` (present on the host) rather than link libgit2: the
// porcelain formats below map 1:1 to the existing TS shapes, and the field/record
// separators (\x1f / \x1e) are bytes that never appear in git identity or date
// fields, so parsing stays robust even with newlines in commit bodies.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

// Field separator (unit separator) and record separator — chosen because they
// never occur in git ref names, identities, or ISO dates.
const FIELD_SEP: char = '\u{1f}';
const RECORD_SEP: char = '\u{1e}';

// Cap the DAG size so `buildGraphData`'s O(commits·lanes) layout can't freeze the
// renderer on a giant monorepo. The frontend can request more via `max_count`.
const DEFAULT_MAX_COUNT: u32 = 2000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitAuthor {
    name: String,
    email: String,
    date: String, // ISO 8601
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    sha: String,
    short_sha: String,
    message: String,
    subject: String,
    body: String,
    author: CommitAuthor,
    committer: CommitAuthor,
    parents: Vec<String>,
    is_merge: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    name: String,
    sha: String,
    is_default: bool,
    is_remote: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    name: String,
    sha: String,
    commit_sha: String,
    message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    owner: String,
    repo: String,
    full_name: String,
    default_branch: String,
    description: Option<String>,
    homepage: Option<String>,
    star_count: u32,
    fork_count: u32,
    is_private: bool,
    url: String,
    pushed_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRepoPayload {
    repo_info: RepoInfo,
    branches: Vec<Branch>,
    tags: Vec<Tag>,
    commits: Vec<Commit>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    filename: String,
    status: String,
    additions: u32,
    deletions: u32,
    changes: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_filename: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitStats {
    additions: u32,
    deletions: u32,
    total: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    stats: Option<CommitStats>,
    files: Vec<CommitFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    branch: Option<String>,
    ahead: u32,
    behind: u32,
    staged: Vec<String>,
    unstaged: Vec<String>,
    untracked: Vec<String>,
    clean: bool,
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Run a git subcommand in `repo_path`, returning stdout as a String on success.
fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .map_err(|e| format!("failed to spawn git: {e}. Is git installed?"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git {}: {}", args.join(" "), stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string()
}

// ─── Commands ───────────────────────────────────────────────────────────────

/// Load a local repository's full graph payload. Mirrors `fetchFullRepository`.
#[tauri::command]
pub fn git_full_repository(
    repo_path: String,
    max_count: Option<u32>,
) -> Result<LocalRepoPayload, String> {
    // Validate it's a git repo and resolve the toplevel.
    let toplevel = run_git(&repo_path, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    if toplevel.is_empty() {
        return Err("Not a git repository.".to_string());
    }

    let default_branch = run_git(&toplevel, &["rev-parse", "--abbrev-ref", "HEAD"])
        .unwrap_or_default()
        .trim()
        .to_string();

    let commits = parse_commits(&toplevel, max_count.unwrap_or(DEFAULT_MAX_COUNT))?;
    let (branches, tags) = parse_refs(&toplevel, &default_branch)?;

    let repo = basename(&toplevel);
    // Best-effort owner from an `origin` remote; falls back to "local".
    let owner = run_git(&toplevel, &["remote", "get-url", "origin"])
        .ok()
        .and_then(|url| owner_from_remote(url.trim()))
        .unwrap_or_else(|| "local".to_string());

    let pushed_at = commits.first().map(|c| c.committer.date.clone());

    let repo_info = RepoInfo {
        owner: owner.clone(),
        repo: repo.clone(),
        full_name: format!("{owner}/{repo}"),
        default_branch: if default_branch.is_empty() {
            "HEAD".to_string()
        } else {
            default_branch
        },
        description: None,
        homepage: None,
        star_count: 0,
        fork_count: 0,
        is_private: true,
        url: toplevel.clone(),
        pushed_at,
    };

    Ok(LocalRepoPayload {
        repo_info,
        branches,
        tags,
        commits,
    })
}

fn owner_from_remote(url: &str) -> Option<String> {
    // git@github.com:owner/repo.git  or  https://github.com/owner/repo.git
    let path = url
        .rsplit_once(':')
        .map(|(_, p)| p)
        .or_else(|| url.split_once("//").map(|(_, p)| p))
        .unwrap_or(url);
    let parts: Vec<&str> = path.trim_end_matches(".git").split('/').collect();
    if parts.len() >= 2 {
        Some(parts[parts.len() - 2].to_string())
    } else {
        None
    }
}

fn parse_commits(toplevel: &str, max_count: u32) -> Result<Vec<Commit>, String> {
    // Field order: %H %h %P %an %ae %aI %cn %ce %cI %s %b, records split on \x1e.
    let format = format!(
        "%H{s}%h{s}%P{s}%an{s}%ae{s}%aI{s}%cn{s}%ce{s}%cI{s}%s{s}%b{r}",
        s = FIELD_SEP,
        r = RECORD_SEP
    );
    let pretty = format!("--pretty=format:{format}");
    let max = format!("--max-count={max_count}");
    let raw = run_git(
        toplevel,
        &["log", "--all", "--date=iso-strict", &pretty, &max],
    )?;

    let mut commits = Vec::new();
    for record in raw.split(RECORD_SEP) {
        let record = record.trim_start_matches('\n');
        if record.trim().is_empty() {
            continue;
        }
        let fields: Vec<&str> = record.split(FIELD_SEP).collect();
        if fields.len() < 11 {
            continue;
        }
        let parents: Vec<String> = fields[2]
            .split_whitespace()
            .map(|s| s.to_string())
            .collect();
        let is_merge = parents.len() > 1;
        let subject = fields[9].to_string();
        let body = fields[10].trim_end().to_string();
        let message = if body.is_empty() {
            subject.clone()
        } else {
            format!("{subject}\n\n{body}")
        };
        commits.push(Commit {
            sha: fields[0].to_string(),
            short_sha: fields[1].to_string(),
            message,
            subject,
            body,
            author: CommitAuthor {
                name: fields[3].to_string(),
                email: fields[4].to_string(),
                date: fields[5].to_string(),
            },
            committer: CommitAuthor {
                name: fields[6].to_string(),
                email: fields[7].to_string(),
                date: fields[8].to_string(),
            },
            parents,
            is_merge,
        });
    }
    Ok(commits)
}

fn parse_refs(toplevel: &str, default_branch: &str) -> Result<(Vec<Branch>, Vec<Tag>), String> {
    // %(objectname) %(refname) %(HEAD) %(*objectname) — the peeled objectname is
    // populated for annotated tags so we resolve tags to their commit sha.
    let format = format!(
        "%(objectname){s}%(refname){s}%(HEAD){s}%(*objectname)",
        s = FIELD_SEP
    );
    let raw = run_git(
        toplevel,
        &[
            "for-each-ref",
            &format!("--format={format}"),
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?;

    let mut branches = Vec::new();
    let mut tags = Vec::new();

    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split(FIELD_SEP).collect();
        if fields.len() < 3 {
            continue;
        }
        let objectname = fields[0].to_string();
        let refname = fields[1];
        let is_head = fields.get(2).map(|h| *h == "*").unwrap_or(false);
        let peeled = fields.get(3).map(|s| s.to_string()).unwrap_or_default();

        if let Some(name) = refname.strip_prefix("refs/heads/") {
            branches.push(Branch {
                name: name.to_string(),
                sha: objectname,
                is_default: is_head || name == default_branch,
                is_remote: false,
            });
        } else if let Some(name) = refname.strip_prefix("refs/remotes/") {
            // Skip the symbolic origin/HEAD pointer.
            if name.ends_with("/HEAD") {
                continue;
            }
            branches.push(Branch {
                name: name.to_string(),
                sha: objectname,
                is_default: false,
                is_remote: true,
            });
        } else if let Some(name) = refname.strip_prefix("refs/tags/") {
            let commit_sha = if peeled.is_empty() {
                objectname.clone()
            } else {
                peeled
            };
            tags.push(Tag {
                name: name.to_string(),
                sha: objectname,
                commit_sha,
                message: None,
            });
        }
    }

    Ok((branches, tags))
}

/// Per-commit file stats. Mirrors `fetchCommitDetails`.
#[tauri::command]
pub fn git_commit_details(repo_path: String, sha: String) -> Result<CommitDetails, String> {
    let raw = run_git(
        &repo_path,
        &[
            "show",
            "--numstat",
            "--format=",
            "--no-color",
            &sha,
        ],
    )?;

    let mut files = Vec::new();
    let mut total_add = 0u32;
    let mut total_del = 0u32;

    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.splitn(3, '\t').collect();
        if cols.len() < 3 {
            continue;
        }
        // Binary files show '-' for counts.
        let additions: u32 = cols[0].parse().unwrap_or(0);
        let deletions: u32 = cols[1].parse().unwrap_or(0);
        total_add += additions;
        total_del += deletions;

        // Rename form: "old => new" or "dir/{old => new}/file".
        let (filename, previous_filename) = parse_numstat_path(cols[2]);
        files.push(CommitFile {
            filename,
            status: "modified".to_string(),
            additions,
            deletions,
            changes: additions + deletions,
            previous_filename,
        });
    }

    Ok(CommitDetails {
        stats: Some(CommitStats {
            additions: total_add,
            deletions: total_del,
            total: total_add + total_del,
        }),
        files,
    })
}

fn parse_numstat_path(raw: &str) -> (String, Option<String>) {
    if let Some(arrow) = raw.find(" => ") {
        // Handle "{old => new}" brace form and the plain "old => new" form.
        if let (Some(open), Some(close)) = (raw.find('{'), raw.find('}')) {
            let prefix = &raw[..open];
            let suffix = &raw[close + 1..];
            let inner = &raw[open + 1..close];
            if let Some(a) = inner.find(" => ") {
                let old = format!("{}{}{}", prefix, &inner[..a], suffix);
                let new = format!("{}{}{}", prefix, &inner[a + 4..], suffix);
                return (new, Some(old));
            }
        }
        let old = raw[..arrow].to_string();
        let new = raw[arrow + 4..].to_string();
        return (new, Some(old));
    }
    (raw.to_string(), None)
}

/// Working-tree status. Feeds `session_context.git_status` for the agent.
#[tauri::command]
pub fn git_status(repo_path: String) -> Result<GitStatus, String> {
    let raw = run_git(&repo_path, &["status", "--porcelain=v2", "--branch"])?;

    let mut status = GitStatus {
        branch: None,
        ahead: 0,
        behind: 0,
        staged: Vec::new(),
        unstaged: Vec::new(),
        untracked: Vec::new(),
        clean: true,
    };

    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            status.branch = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            // Format: "+A -B"
            for tok in rest.split_whitespace() {
                if let Some(a) = tok.strip_prefix('+') {
                    status.ahead = a.parse().unwrap_or(0);
                } else if let Some(b) = tok.strip_prefix('-') {
                    status.behind = b.parse().unwrap_or(0);
                }
            }
        } else if let Some(rest) = line.strip_prefix("1 ").or_else(|| line.strip_prefix("2 ")) {
            // Ordinary/renamed entry: XY field is first, path is last token.
            let xy = rest.split_whitespace().next().unwrap_or("..");
            let path = line.rsplit('\t').next().and_then(|_| line.split_whitespace().last());
            if let Some(p) = path {
                let mut chars = xy.chars();
                let staged_state = chars.next().unwrap_or('.');
                let unstaged_state = chars.next().unwrap_or('.');
                if staged_state != '.' {
                    status.staged.push(p.to_string());
                    status.clean = false;
                }
                if unstaged_state != '.' {
                    status.unstaged.push(p.to_string());
                    status.clean = false;
                }
            }
        } else if let Some(rest) = line.strip_prefix("? ") {
            status.untracked.push(rest.to_string());
            status.clean = false;
        }
    }

    Ok(status)
}
