use crate::commands::graph::GraphRegistry;
use crate::workspace::page::PageMeta;
use crate::workspace::scan::scan_pages;
use crate::workspace::watcher::FileWatcher;
use crate::workspace::write_hash::WriteHashRegistry;
use crate::{InitialWorkspace, InitialFile, InitialLine, InitialCol};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State, WebviewWindowBuilder};

pub struct WorkspaceEntry {
    pub root: PathBuf,
    #[allow(dead_code)]
    pub watcher: Option<FileWatcher>,
    /// Reverse companion index: canonical absolute PDF path -> md relative path.
    /// Built during `annotate_companions` from markdown `companion:` frontmatter,
    /// so a PDF can be mapped back to the md note that declares it without
    /// walking the filesystem. Canonical keys handle case-insensitive macOS APFS
    /// and symlinks.
    pub companion_reverse_map: HashMap<PathBuf, String>,
}

pub struct WorkspaceRegistry {
    pub workspaces: Mutex<HashMap<String, WorkspaceEntry>>,
}

/// A resolved companion file plus the page offset to apply when syncing scroll
/// position between a markdown note and its companion PDF. `page_offset` is the
/// number of leading PDF pages trimmed before OCR (0 when none): forward sync
/// adds it (md page -> pdf page), reverse sync subtracts it (pdf page -> md page).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionInfo {
    pub path: String,
    pub page_offset: i32,
}

impl WorkspaceRegistry {
    pub fn find_window_for_workspace(&self, workspace_path: &Path) -> Option<String> {
        let target = workspace_path
            .canonicalize()
            .unwrap_or_else(|_| workspace_path.to_path_buf());
        let workspaces = self.workspaces.lock().unwrap();
        workspaces.iter().find_map(|(label, entry)| {
            let stored = entry
                .root
                .canonicalize()
                .unwrap_or_else(|_| entry.root.clone());
            if stored == target {
                Some(label.clone())
            } else {
                None
            }
        })
    }
}

pub struct PendingWorkspaces(pub Mutex<HashMap<String, String>>);
pub struct PendingFiles(pub Mutex<HashMap<String, String>>);
pub struct PendingLines(pub Mutex<HashMap<String, u32>>);
pub struct PendingCols(pub Mutex<HashMap<String, u32>>);

pub fn persist_last_workspace(app_data_dir: &Path, workspace_path: &str) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(app_data_dir)?;
    std::fs::write(app_data_dir.join("last-workspace"), workspace_path)
}

pub fn read_last_workspace(app_data_dir: &Path) -> Option<String> {
    std::fs::read_to_string(app_data_dir.join("last-workspace"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[derive(serde::Serialize, Clone)]
pub struct CliNavigatePayload {
    pub file: Option<String>,
    pub line: Option<u32>,
    pub col: Option<u32>,
}

pub fn try_navigate_existing_window(
    app_handle: &tauri::AppHandle,
    workspace_path: &str,
    file: Option<&str>,
    line: Option<u32>,
    col: Option<u32>,
) -> Option<String> {
    let registry = app_handle.try_state::<WorkspaceRegistry>()?;
    let target_path = PathBuf::from(workspace_path);
    let label = registry.find_window_for_workspace(&target_path)?;

    if let Err(e) = app_handle.emit_to(
        label.as_str(),
        "lit:cli-navigate",
        CliNavigatePayload {
            file: file.map(|s| s.to_string()),
            line,
            col,
        },
    ) {
        tracing::warn!(
            label,
            error = %e,
            "emit_to failed for cli-navigate, falling back to new window"
        );
        return None;
    }

    if let Some(win) = app_handle.get_webview_window(&label) {
        let _ = win.set_focus();
    }

    Some(label)
}

/// Canonicalize `absolute` (a file known to exist under `root`) and return its
/// workspace-relative path as a forward-slash string. On case-insensitive
/// filesystems (macOS APFS) this recovers the real on-disk filename casing.
/// If the canonical path escapes `root` (e.g. the file is a symlink pointing
/// outside), fall back to `candidate` — the original relative path, which is
/// still valid for opening.
fn canonicalize_within_root(root: &Path, absolute: &Path, candidate: &Path) -> String {
    root.canonicalize()
        .ok()
        .and_then(|canon_root| {
            absolute
                .canonicalize()
                .ok()
                .and_then(|canon_abs| crate::util::relative_to_root(&canon_root, &canon_abs))
        })
        .unwrap_or_else(|| {
            candidate
                .to_string_lossy()
                .replace(std::path::MAIN_SEPARATOR, "/")
        })
}

/// Read the first 4 KiB of a markdown file and return both the resolved
/// `companion:` path and the `companion_page_offset:` (defaulting to 0)
/// from a single frontmatter parse.  Returns `None` when the file is
/// unreadable, has no frontmatter, or the `companion:` target does not
/// exist under `root`.
fn companion_info_from_frontmatter(root: &Path, relative_path: &str) -> Option<(String, i32)> {
    use std::io::Read;
    let full_path = root.join(relative_path);
    let mut file = std::fs::File::open(&full_path).ok()?;
    let mut buf = [0u8; 4096];
    let n = file.read(&mut buf).ok()?;
    let header = std::str::from_utf8(&buf[..n]).ok()?;
    let parsed = crate::workspace::frontmatter::parse_frontmatter(header);
    let companion_value = parsed.map.get("companion")?.as_str()?;
    let candidate = Path::new(companion_value);
    let absolute = root.join(companion_value);
    if !absolute.is_file() {
        return None;
    }
    let resolved = canonicalize_within_root(root, &absolute, candidate);
    let offset = parsed
        .map
        .get("companion_page_offset")
        .and_then(|v| v.as_i64())
        .map(|n| n as i32)
        .unwrap_or(0);
    Some((resolved, offset))
}

/// Read the first 4 KiB of a markdown file and return the `companion:`
/// frontmatter value if it points to an existing file under `root`.
fn companion_from_frontmatter(root: &Path, relative_path: &str) -> Option<String> {
    companion_info_from_frontmatter(root, relative_path).map(|(path, _offset)| path)
}

/// Read the first 4 KiB of a markdown file and return its `companion_page_offset`
/// frontmatter value as an i32, defaulting to 0 when the file is missing,
/// unreadable, or the key is absent. `md_path` may be workspace-relative or
/// absolute; it is joined onto `root` (an absolute `md_path` wins, per
/// `Path::join` semantics).
fn read_page_offset(root: &Path, md_path: &str) -> i32 {
    use std::io::Read;
    let full_path = root.join(md_path);
    let Ok(mut file) = std::fs::File::open(&full_path) else {
        return 0;
    };
    let mut buf = [0u8; 4096];
    let Ok(n) = file.read(&mut buf) else { return 0 };
    let Ok(header) = std::str::from_utf8(&buf[..n]) else {
        return 0;
    };
    let parsed = crate::workspace::frontmatter::parse_frontmatter(header);
    parsed
        .map
        .get("companion_page_offset")
        .and_then(|v| v.as_i64())
        .map(|n| n as i32)
        .unwrap_or(0)
}

/// Resolve the page offset for a companion pair. The offset always lives in the
/// markdown note's frontmatter, so pick whichever of the source/companion paths
/// is the `.md` file and read it. Returns 0 when neither side is markdown.
fn companion_page_offset(root: &Path, source_rel: &str, companion_rel: &str) -> i32 {
    let md = if source_rel.to_ascii_lowercase().ends_with(".md") {
        source_rel
    } else {
        companion_rel
    };
    read_page_offset(root, md)
}

/// Find a companion by same-name sibling or search-path lookup only (no
/// frontmatter). Given a workspace-relative path, swap the extension
/// (md<->pdf) and look for that file first in the same directory, then in
/// each of `search_paths`. Returns `None` for unsupported extensions or when
/// no sibling/search-path companion exists. This is the I/O-free-of-frontmatter
/// counterpart to `find_companion`.
fn find_companion_by_sibling(relative_path: &str, root: &Path, search_paths: &[String]) -> Option<String> {
    let rel = Path::new(relative_path);
    let ext = rel.extension()?.to_str()?.to_ascii_lowercase();
    let target_ext = match ext.as_str() {
        "md" => "pdf",
        "pdf" => "md",
        _ => return None,
    };
    let candidate = rel.with_extension(target_ext);
    let absolute = root.join(&candidate);
    if absolute.is_file() {
        return Some(canonicalize_within_root(root, &absolute, &candidate));
    }
    // Same-directory sibling missing — search the configured directories for a
    // file with the same name and the swapped extension.
    let file_name = candidate.file_name()?;
    for entry in search_paths {
        let cand = Path::new(entry).join(file_name);
        let abs = root.join(&cand);
        if abs.is_file() {
            return Some(canonicalize_within_root(root, &abs, &cand));
        }
    }
    None
}

/// Given a workspace-relative path to a markdown or PDF file, return the
/// path of its sibling with the swapped extension (md<->pdf) if that sibling
/// exists on disk. For markdown files, also checks `companion:` frontmatter
/// first. Looks first in the same directory under `root`, then in each of
/// `search_paths` (workspace-relative or absolute directories) for a file
/// with the same name and the swapped extension. Returns `None` for
/// unsupported extensions or when no companion exists. The returned string
/// uses forward slashes; it is workspace-relative when the companion is under
/// `root`, or absolute when found via an absolute search path outside `root`.
pub fn find_companion(relative_path: &str, root: &Path, search_paths: &[String]) -> Option<String> {
    let ext = Path::new(relative_path).extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "md" | "pdf" => {}
        _ => return None,
    }
    if ext == "md" {
        if let Some(companion) = companion_from_frontmatter(root, relative_path) {
            return Some(companion);
        }
    }
    find_companion_by_sibling(relative_path, root, search_paths)
}

/// Look up the markdown note that declares `pdf_relative_path` as its
/// `companion:` via the reverse map built by `annotate_companions`. Keys are
/// canonical absolute PDF paths, so canonicalize the query path before lookup.
/// The returned md path is routed through `canonicalize_within_root` to recover
/// real on-disk casing and guarantee it stays inside `root`.
fn reverse_companion_lookup(
    root: &Path,
    pdf_relative_path: &str,
    map: &HashMap<PathBuf, String>,
) -> Option<String> {
    let canon = root.join(pdf_relative_path).canonicalize().ok()?;
    let md_rel = map.get(&canon)?;
    Some(canonicalize_within_root(root, &root.join(md_rel), Path::new(md_rel)))
}

/// Cheap boolean check: is the canonical absolute path of `pdf_relative_path`
/// present as a key in the reverse map? Unlike `reverse_companion_lookup` this
/// skips the md-path canonicalization (two extra syscalls) that callers needing
/// only a boolean don't need.
fn reverse_map_contains_pdf(
    root: &Path,
    pdf_relative_path: &str,
    map: &HashMap<PathBuf, String>,
) -> bool {
    root.join(pdf_relative_path)
        .canonicalize()
        .ok()
        .map_or(false, |canon| map.contains_key(&canon))
}

/// Annotate each page's `has_companion` flag and build a reverse companion
/// index (canonical absolute PDF path -> md relative path) from markdown
/// `companion:` frontmatter.
///
/// Two-phase so a PDF whose companion is declared only via another note's
/// frontmatter (no same-name sibling) is still flagged:
///   Phase 1 — set `has_companion` for every page via `find_companion`; for
///             markdown pages, also record any frontmatter `companion:` target
///             in the reverse map. The first md (by sorted `relative_path`) to
///             claim a given PDF wins, making the map deterministic.
///   Phase 2 — for PDF pages still unflagged, check the reverse map.
fn annotate_companions(
    pages: &mut [PageMeta],
    root: &Path,
    search_paths: &[String],
) -> HashMap<PathBuf, String> {
    let mut reverse_map: HashMap<PathBuf, String> = HashMap::new();

    // Ensure deterministic "first md wins" tie-break regardless of caller
    // sort order. The doc contract says the first md by sorted relative_path
    // claims each PDF; enforce that here rather than relying on callers.
    pages.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    // Phase 1: forward companion detection + reverse-map construction.
    // For markdown pages, call companion_from_frontmatter once and reuse the
    // result for both has_companion and the reverse-map insertion, falling
    // through to the sibling-only helper when frontmatter returns None.
    for page in pages.iter_mut() {
        if page.relative_path.to_ascii_lowercase().ends_with(".md") {
            if let Some(companion) = companion_from_frontmatter(root, &page.relative_path) {
                page.has_companion = true;
                if let Ok(canon) = root.join(&companion).canonicalize() {
                    reverse_map
                        .entry(canon)
                        .or_insert_with(|| page.relative_path.clone());
                }
                continue;
            }
        }
        page.has_companion =
            find_companion_by_sibling(&page.relative_path, root, search_paths).is_some();
    }

    // Phase 2: PDFs with no same-name md sibling but claimed via frontmatter.
    for page in pages.iter_mut() {
        if !page.has_companion
            && page.relative_path.to_ascii_lowercase().ends_with(".pdf")
            && reverse_map_contains_pdf(root, &page.relative_path, &reverse_map)
        {
            page.has_companion = true;
        }
    }

    reverse_map
}

pub fn get_workspace_root(registry: &WorkspaceRegistry, label: &str) -> Result<PathBuf, String> {
    let workspaces = registry.workspaces.lock().unwrap();
    workspaces
        .get(label)
        .map(|e| e.root.clone())
        .ok_or_else(|| format!("No workspace open in window '{label}'"))
}

/// Clone both root and companion_reverse_map from the same WorkspaceEntry
/// under a single lock acquisition so they cannot come from different
/// workspace versions. This closes the TOCTOU race where `open_workspace`
/// could replace the entry between two separate lock acquisitions.
pub fn get_workspace_root_and_reverse_map(
    registry: &WorkspaceRegistry,
    label: &str,
) -> Result<(PathBuf, HashMap<PathBuf, String>), String> {
    let workspaces = registry.workspaces.lock().unwrap();
    workspaces
        .get(label)
        .map(|e| (e.root.clone(), e.companion_reverse_map.clone()))
        .ok_or_else(|| format!("No workspace open in window '{label}'"))
}

#[tauri::command]
pub fn open_workspace(
    path: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    app_handle: tauri::AppHandle,
    registry: State<Arc<WriteHashRegistry>>,
    graph_state: State<Arc<GraphRegistry>>,
    build_state: State<Arc<crate::commands::graph::GraphBuildState>>,
) -> Result<Vec<PageMeta>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a valid directory: {path}"));
    }

    let mut pages = scan_pages(&root).map_err(|e| e.to_string())?;

    let prefs = crate::preferences::read_preferences(&app_handle);
    let search_paths = crate::preferences::companion_search_paths(&prefs);
    let reverse_map = annotate_companions(&mut pages, &root, &search_paths);

    app_handle
        .asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|e| e.to_string())?;

    let initial_paths: HashSet<String> = pages.iter().map(|p| p.relative_path.clone()).collect();

    let label = window.label().to_string();
    let watcher = FileWatcher::new(
        root.clone(),
        label.clone(),
        app_handle.clone(),
        Arc::clone(&registry),
        initial_paths,
    )
    .ok();

    state.workspaces.lock().unwrap().insert(
        label,
        WorkspaceEntry {
            root: root.clone(),
            watcher,
            companion_reverse_map: reverse_map,
        },
    );

    let graph_root = root.clone();
    let build_st = Arc::clone(&build_state);

    if !build_st.is_in_progress(&graph_root) {
        let graph_reg = Arc::clone(&graph_state);
        let handle = app_handle.clone();
        let build_st = Arc::clone(&build_st);
        build_st.start_build(graph_root.clone());

        tauri::async_runtime::spawn_blocking(move || {
            super::graph::initialize_graph_index(
                graph_root,
                build_st,
                graph_reg,
                handle,
            );
        });
    }

    if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
        let _ = persist_last_workspace(&app_data_dir, &path);
    }

    Ok(pages)
}

/// Extend the Tauri asset protocol scope to include a single file.
///
/// The PDF viewer (`PdfViewer.tsx`) calls this before loading a PDF via
/// `convertFileSrc` so that files outside the scanned workspace root
/// (e.g. companions found via absolute search paths) are served by the
/// asset protocol. The call is idempotent — re-allowing an already-scoped
/// file is harmless.
#[tauri::command]
pub fn allow_asset_scope(
    path: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    app_handle
        .asset_protocol_scope()
        .allow_file(&file_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_pages(
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<PageMeta>, String> {
    let root = get_workspace_root(&state, window.label())?;
    let mut pages = scan_pages(&root).map_err(|e| e.to_string())?;
    let prefs = crate::preferences::read_preferences(&app_handle);
    let search_paths = crate::preferences::companion_search_paths(&prefs);
    let reverse_map = annotate_companions(&mut pages, &root, &search_paths);
    if let Some(entry) = state.workspaces.lock().unwrap().get_mut(window.label()) {
        entry.companion_reverse_map = reverse_map;
    }
    Ok(pages)
}

#[tauri::command]
pub fn get_workspace_path(
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
) -> Result<Option<String>, String> {
    let workspaces = state.workspaces.lock().unwrap();
    Ok(workspaces
        .get(window.label())
        .map(|e| e.root.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn find_companion_file(
    relative_path: String,
    window: tauri::Window,
    state: State<WorkspaceRegistry>,
    app_handle: tauri::AppHandle,
) -> Result<Option<CompanionInfo>, String> {
    let prefs = crate::preferences::read_preferences(&app_handle);
    let search_paths = crate::preferences::companion_search_paths(&prefs);
    let is_pdf = relative_path.to_ascii_lowercase().ends_with(".pdf");

    if is_pdf {
        // PDF input: snapshot root + reverse_map under a single lock so they
        // cannot come from different workspace versions (TOCTOU safety).
        let (root, reverse_map) =
            get_workspace_root_and_reverse_map(&state, window.label())?;
        if let Some(found) = find_companion(&relative_path, &root, &search_paths) {
            let page_offset = companion_page_offset(&root, &relative_path, &found);
            return Ok(Some(CompanionInfo { path: found, page_offset }));
        }
        // Forward lookup missed — fall back to the reverse map.
        Ok(reverse_companion_lookup(&root, &relative_path, &reverse_map).map(|found| {
            let page_offset = companion_page_offset(&root, &relative_path, &found);
            CompanionInfo { path: found, page_offset }
        }))
    } else {
        // Non-PDF input (e.g. markdown): only the root is needed.
        // The reverse map is keyed by canonical PDF paths so it can never
        // match a non-PDF input — skip cloning it entirely.
        let root = get_workspace_root(&state, window.label())?;
        // Fast path: read frontmatter once for both companion path and offset.
        if let Some((path, page_offset)) =
            companion_info_from_frontmatter(&root, &relative_path)
        {
            return Ok(Some(CompanionInfo { path, page_offset }));
        }
        // Fallback: sibling/search-path lookup (no frontmatter read needed
        // since we already know frontmatter returned None).
        Ok(find_companion_by_sibling(&relative_path, &root, &search_paths).map(|found| {
            let page_offset = companion_page_offset(&root, &relative_path, &found);
            CompanionInfo { path: found, page_offset }
        }))
    }
}

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

pub fn create_workspace_window(
    app_handle: &tauri::AppHandle,
    path: Option<String>,
    file: Option<String>,
    line: Option<u32>,
    col: Option<u32>,
) -> Result<String, String> {
    let id = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("workspace-{id}");
    if let Some(ref p) = path {
        if let Some(pending) = app_handle.try_state::<PendingWorkspaces>() {
            pending.0.lock().unwrap().insert(label.clone(), p.clone());
        }
    }
    if let Some(ref f) = file {
        if let Some(pending) = app_handle.try_state::<PendingFiles>() {
            pending.0.lock().unwrap().insert(label.clone(), f.clone());
        }
    }
    if let Some(l) = line {
        if let Some(pending) = app_handle.try_state::<PendingLines>() {
            pending.0.lock().unwrap().insert(label.clone(), l);
        }
    }
    if let Some(c) = col {
        if let Some(pending) = app_handle.try_state::<PendingCols>() {
            pending.0.lock().unwrap().insert(label.clone(), c);
        }
    }
    let mut builder = WebviewWindowBuilder::new(app_handle, &label, tauri::WebviewUrl::default())
        .title("Lit")
        .inner_size(1024.0, 768.0);

    if let Some(script) = crate::cli_init_script(&path, &file, &line, &col) {
        builder = builder.initialization_script(&script);
    }

    builder
        .build()
        .map_err(|e| format!("Failed to create window: {e}"))?;
    Ok(label)
}

#[tauri::command]
pub fn open_workspace_window(
    path: Option<String>,
    app_handle: tauri::AppHandle,
    _state: State<PendingWorkspaces>,
) -> Result<String, String> {
    create_workspace_window(&app_handle, path, None, None, None)
}

#[tauri::command]
pub fn get_pending_workspace(
    window: tauri::Window,
    state: State<PendingWorkspaces>,
) -> Option<String> {
    state.0.lock().unwrap().remove(window.label())
}

#[tauri::command]
pub fn get_pending_file(
    window: tauri::Window,
    state: State<PendingFiles>,
) -> Option<String> {
    state.0.lock().unwrap().remove(window.label())
}

#[tauri::command]
pub fn get_pending_line(
    window: tauri::Window,
    state: State<PendingLines>,
) -> Option<u32> {
    state.0.lock().unwrap().remove(window.label())
}

#[tauri::command]
pub fn get_pending_col(
    window: tauri::Window,
    state: State<PendingCols>,
) -> Option<u32> {
    state.0.lock().unwrap().remove(window.label())
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct StartupContext {
    pub workspace: Option<String>,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub col: Option<u32>,
}

#[tauri::command]
pub fn get_startup_context(
    window: tauri::Window,
    pending_ws: State<PendingWorkspaces>,
    pending_files: State<PendingFiles>,
    pending_lines: State<PendingLines>,
    pending_cols: State<PendingCols>,
    initial_ws: State<InitialWorkspace>,
    initial_file: State<InitialFile>,
    initial_line: State<InitialLine>,
    initial_col: State<InitialCol>,
) -> StartupContext {
    let label = window.label();
    let workspace = pending_ws.0.lock().unwrap().remove(label);
    if workspace.is_some() {
        return StartupContext {
            workspace,
            file: pending_files.0.lock().unwrap().remove(label),
            line: pending_lines.0.lock().unwrap().remove(label),
            col: pending_cols.0.lock().unwrap().remove(label),
        };
    }
    StartupContext {
        workspace: initial_ws.0.lock().unwrap().take(),
        file: initial_file.0.lock().unwrap().take(),
        line: initial_line.0.lock().unwrap().take(),
        col: initial_col.0.lock().unwrap().take(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use indexmap::IndexMap;

    #[test]
    fn registry_starts_empty() {
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(HashMap::new()),
        };
        assert!(registry.workspaces.lock().unwrap().is_empty());
    }

    #[test]
    fn get_workspace_root_returns_error_for_unknown_label() {
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(HashMap::new()),
        };
        let result = get_workspace_root(&registry, "unknown");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown"));
    }

    #[test]
    fn get_workspace_root_returns_path_for_known_label() {
        let mut map = HashMap::new();
        map.insert(
            "main".to_string(),
            WorkspaceEntry {
                root: PathBuf::from("/test/workspace"),
                watcher: None,
                companion_reverse_map: HashMap::new(),
            },
        );
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(map),
        };
        let result = get_workspace_root(&registry, "main");
        assert_eq!(result.unwrap(), PathBuf::from("/test/workspace"));
    }

    #[test]
    fn persist_and_read_last_workspace_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        persist_last_workspace(dir.path(), "/my/vault").unwrap();
        assert_eq!(
            read_last_workspace(dir.path()),
            Some("/my/vault".to_string())
        );
    }

    #[test]
    fn read_last_workspace_returns_none_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_last_workspace(dir.path()), None);
    }

    #[test]
    fn persist_last_workspace_overwrites_previous() {
        let dir = tempfile::tempdir().unwrap();
        persist_last_workspace(dir.path(), "/old/path").unwrap();
        persist_last_workspace(dir.path(), "/new/path").unwrap();
        assert_eq!(
            read_last_workspace(dir.path()),
            Some("/new/path".to_string())
        );
    }

    #[test]
    fn read_last_workspace_returns_none_for_empty_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("last-workspace"), "").unwrap();
        assert_eq!(read_last_workspace(dir.path()), None);
    }

    #[test]
    fn read_last_workspace_trims_whitespace() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("last-workspace"), "  /my/vault  \n").unwrap();
        assert_eq!(
            read_last_workspace(dir.path()),
            Some("/my/vault".to_string())
        );
    }

    fn make_startup_context(
        pending_ws: Option<&str>,
        pending_file: Option<&str>,
        pending_line: Option<u32>,
        pending_col: Option<u32>,
        initial_ws: Option<&str>,
        initial_file: Option<&str>,
        initial_line: Option<u32>,
        initial_col: Option<u32>,
        label: &str,
    ) -> StartupContext {
        let mut pw = HashMap::new();
        if let Some(v) = pending_ws {
            pw.insert(label.to_string(), v.to_string());
        }
        let mut pf = HashMap::new();
        if let Some(v) = pending_file {
            pf.insert(label.to_string(), v.to_string());
        }
        let mut pl = HashMap::new();
        if let Some(v) = pending_line {
            pl.insert(label.to_string(), v);
        }
        let mut pc = HashMap::new();
        if let Some(v) = pending_col {
            pc.insert(label.to_string(), v);
        }

        let pws = PendingWorkspaces(Mutex::new(pw));
        let pfs = PendingFiles(Mutex::new(pf));
        let pls = PendingLines(Mutex::new(pl));
        let pcs = PendingCols(Mutex::new(pc));
        let iws = InitialWorkspace(Mutex::new(initial_ws.map(|s| s.to_string())));
        let ifs = InitialFile(Mutex::new(initial_file.map(|s| s.to_string())));
        let ils = InitialLine(Mutex::new(initial_line));
        let ics = InitialCol(Mutex::new(initial_col));

        let workspace = pws.0.lock().unwrap().remove(label);
        if workspace.is_some() {
            return StartupContext {
                workspace,
                file: pfs.0.lock().unwrap().remove(label),
                line: pls.0.lock().unwrap().remove(label),
                col: pcs.0.lock().unwrap().remove(label),
            };
        }
        let workspace = iws.0.lock().unwrap().take();
        let file = ifs.0.lock().unwrap().take();
        let line = ils.0.lock().unwrap().take();
        let col = ics.0.lock().unwrap().take();
        StartupContext { workspace, file, line, col }
    }

    #[test]
    fn startup_context_pending_wins_over_initial() {
        let ctx = make_startup_context(
            Some("/pending/vault"),
            Some("pending.md"),
            Some(10),
            Some(5),
            Some("/initial/vault"),
            Some("initial.md"),
            Some(1),
            Some(1),
            "main",
        );
        assert_eq!(ctx, StartupContext {
            workspace: Some("/pending/vault".to_string()),
            file: Some("pending.md".to_string()),
            line: Some(10),
            col: Some(5),
        });
    }

    #[test]
    fn startup_context_falls_back_to_initial() {
        let ctx = make_startup_context(
            None, None, None, None,
            Some("/initial/vault"),
            Some("initial.md"),
            Some(42),
            Some(7),
            "main",
        );
        assert_eq!(ctx, StartupContext {
            workspace: Some("/initial/vault".to_string()),
            file: Some("initial.md".to_string()),
            line: Some(42),
            col: Some(7),
        });
    }

    #[test]
    fn startup_context_returns_all_none_when_empty() {
        let ctx = make_startup_context(
            None, None, None, None,
            None, None, None, None,
            "main",
        );
        assert_eq!(ctx, StartupContext {
            workspace: None,
            file: None,
            line: None,
            col: None,
        });
    }

    #[test]
    fn startup_context_pending_workspace_only() {
        let ctx = make_startup_context(
            Some("/pending/vault"),
            None, None, None,
            Some("/initial/vault"),
            Some("initial.md"),
            Some(1),
            Some(1),
            "main",
        );
        assert_eq!(ctx.workspace, Some("/pending/vault".to_string()));
        assert_eq!(ctx.file, None);
        assert_eq!(ctx.line, None);
        assert_eq!(ctx.col, None);
    }

    #[test]
    fn canonicalize_within_root_returns_relative_for_path_inside_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(root.join("notes/paper.pdf"), "x").unwrap();
        let absolute = root.join("notes/paper.pdf");
        let candidate = Path::new("notes/paper.pdf");
        assert_eq!(
            canonicalize_within_root(root, &absolute, candidate),
            "notes/paper.pdf".to_string()
        );
    }

    #[cfg(unix)]
    #[test]
    fn canonicalize_within_root_falls_back_to_candidate_when_escaping_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let external = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(external.path().join("external")).unwrap();
        std::fs::write(external.path().join("external/real.pdf"), "x").unwrap();
        std::os::unix::fs::symlink(
            external.path().join("external/real.pdf"),
            root.join("paper.pdf"),
        )
        .unwrap();
        let absolute = root.join("paper.pdf");
        let candidate = Path::new("paper.pdf");
        assert_eq!(
            canonicalize_within_root(root, &absolute, candidate),
            "paper.pdf".to_string()
        );
    }

    #[test]
    fn find_companion_empty_search_paths_still_finds_sibling() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(root.join("notes/paper.md"), "x").unwrap();
        std::fs::write(root.join("notes/paper.pdf"), "x").unwrap();
        assert_eq!(
            find_companion("notes/paper.md", root, &[]),
            Some("notes/paper.pdf".to_string())
        );
    }

    #[test]
    fn find_companion_resolves_via_search_path() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::create_dir_all(root.join("pdfs")).unwrap();
        std::fs::write(root.join("notes/paper.md"), "x").unwrap();
        std::fs::write(root.join("pdfs/paper.pdf"), "x").unwrap();
        assert_eq!(
            find_companion("notes/paper.md", root, &["pdfs".to_string()]),
            Some("pdfs/paper.pdf".to_string())
        );
    }

    #[test]
    fn find_companion_sibling_wins_over_search_path() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::create_dir_all(root.join("pdfs")).unwrap();
        std::fs::write(root.join("notes/paper.md"), "x").unwrap();
        std::fs::write(root.join("notes/paper.pdf"), "x").unwrap();
        std::fs::write(root.join("pdfs/paper.pdf"), "x").unwrap();
        assert_eq!(
            find_companion("notes/paper.md", root, &["pdfs".to_string()]),
            Some("notes/paper.pdf".to_string())
        );
    }

    #[test]
    fn find_companion_first_search_path_hit_wins() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("a")).unwrap();
        std::fs::create_dir_all(root.join("b")).unwrap();
        std::fs::write(root.join("paper.md"), "x").unwrap();
        std::fs::write(root.join("a/paper.pdf"), "x").unwrap();
        std::fs::write(root.join("b/paper.pdf"), "x").unwrap();
        assert_eq!(
            find_companion("paper.md", root, &["a".to_string(), "b".to_string()]),
            Some("a/paper.pdf".to_string())
        );
    }

    #[test]
    fn find_companion_reverse_via_search_path() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("pdfs")).unwrap();
        std::fs::create_dir_all(root.join("markdown")).unwrap();
        std::fs::write(root.join("pdfs/paper.pdf"), "x").unwrap();
        std::fs::write(root.join("markdown/paper.md"), "x").unwrap();
        assert_eq!(
            find_companion("pdfs/paper.pdf", root, &["markdown".to_string()]),
            Some("markdown/paper.md".to_string())
        );
    }

    // ---- read_page_offset / companion_page_offset ----

    #[test]
    fn read_page_offset_returns_value_from_frontmatter() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(
            root.join("note.md"),
            "---\ncompanion: a.pdf\ncompanion_page_offset: 3\n---\n# Body\n",
        )
        .unwrap();
        assert_eq!(read_page_offset(root, "note.md"), 3);
    }

    #[test]
    fn read_page_offset_defaults_to_zero_when_absent() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("note.md"), "---\ncompanion: a.pdf\n---\n# Body\n").unwrap();
        assert_eq!(read_page_offset(root, "note.md"), 0);
    }

    #[test]
    fn read_page_offset_defaults_to_zero_for_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert_eq!(read_page_offset(root, "nope.md"), 0);
    }

    #[test]
    fn companion_page_offset_reads_md_source_for_md_to_pdf() {
        // md -> pdf: the offset lives in the SOURCE markdown's frontmatter.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(
            root.join("note.md"),
            "---\ncompanion: assets/pdf/paper.pdf\ncompanion_page_offset: 2\n---\n",
        )
        .unwrap();
        assert_eq!(
            companion_page_offset(root, "note.md", "assets/pdf/paper.pdf"),
            2
        );
    }

    #[test]
    fn companion_page_offset_reads_companion_md_for_pdf_to_md() {
        // pdf -> md: the offset lives in the COMPANION markdown's frontmatter.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(
            root.join("note.md"),
            "---\ncompanion: assets/pdf/paper.pdf\ncompanion_page_offset: 4\n---\n",
        )
        .unwrap();
        assert_eq!(
            companion_page_offset(root, "assets/pdf/paper.pdf", "note.md"),
            4
        );
    }

    // ---- companion_info_from_frontmatter ----

    #[test]
    fn companion_info_from_frontmatter_returns_path_and_offset() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets/pdf")).unwrap();
        std::fs::write(
            root.join("note.md"),
            "---\ncompanion: assets/pdf/paper.pdf\ncompanion_page_offset: 5\n---\nBody\n",
        )
        .unwrap();
        std::fs::write(root.join("assets/pdf/paper.pdf"), b"pdf").unwrap();
        let (path, offset) = companion_info_from_frontmatter(root, "note.md").unwrap();
        assert_eq!(path, "assets/pdf/paper.pdf");
        assert_eq!(offset, 5);
    }

    #[test]
    fn companion_info_from_frontmatter_defaults_offset_to_zero() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(
            root.join("note.md"),
            "---\ncompanion: note.pdf\n---\nBody\n",
        )
        .unwrap();
        std::fs::write(root.join("note.pdf"), b"pdf").unwrap();
        let (path, offset) = companion_info_from_frontmatter(root, "note.md").unwrap();
        assert_eq!(path, "note.pdf");
        assert_eq!(offset, 0);
    }

    #[test]
    fn companion_info_from_frontmatter_returns_none_when_target_missing() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(
            root.join("note.md"),
            "---\ncompanion: missing.pdf\n---\nBody\n",
        )
        .unwrap();
        assert!(companion_info_from_frontmatter(root, "note.md").is_none());
    }

    #[test]
    fn companion_info_from_frontmatter_returns_none_without_companion_key() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(
            root.join("note.md"),
            "---\ntitle: Test\n---\nBody\n",
        )
        .unwrap();
        assert!(companion_info_from_frontmatter(root, "note.md").is_none());
    }

    #[test]
    fn find_companion_dot_search_path_checks_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(root.join("notes/paper.md"), "x").unwrap();
        std::fs::write(root.join("paper.pdf"), "x").unwrap();
        assert_eq!(
            find_companion("notes/paper.md", root, &[".".to_string()]),
            Some("paper.pdf".to_string())
        );
    }

    #[test]
    fn find_companion_no_match_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("a")).unwrap();
        std::fs::create_dir_all(root.join("b")).unwrap();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(root.join("notes/paper.md"), "x").unwrap();
        assert_eq!(
            find_companion("notes/paper.md", root, &["a".to_string(), "b".to_string()]),
            None
        );
    }

    #[test]
    fn find_companion_nonexistent_search_path_is_harmless() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(root.join("notes/paper.md"), "x").unwrap();
        assert_eq!(
            find_companion("notes/paper.md", root, &["nonexistent".to_string()]),
            None
        );
    }

    #[test]
    fn find_companion_md_to_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(root.join("notes/paper.md"), "x").unwrap();
        std::fs::write(root.join("notes/paper.pdf"), "x").unwrap();
        assert_eq!(
            find_companion("notes/paper.md", root, &[]),
            Some("notes/paper.pdf".to_string())
        );
    }

    #[test]
    fn find_companion_pdf_to_md() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(root.join("notes/paper.md"), "x").unwrap();
        std::fs::write(root.join("notes/paper.pdf"), "x").unwrap();
        assert_eq!(
            find_companion("notes/paper.pdf", root, &[]),
            Some("notes/paper.md".to_string())
        );
    }

    #[test]
    fn find_companion_returns_none_when_sibling_missing() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(root.join("notes/paper.md"), "x").unwrap();
        assert_eq!(find_companion("notes/paper.md", root, &[]), None);
    }

    #[test]
    fn find_companion_returns_canonicalized_case() {
        // Even when the input stem has different case from the on-disk file,
        // the returned path should match the real on-disk filename.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(root.join("notes/Paper.md"), "x").unwrap();
        std::fs::write(root.join("notes/Paper.pdf"), "x").unwrap();
        // Ask for the companion of Paper.md — the result should have the exact
        // on-disk case (Paper.pdf), not a fabricated variant.
        let result = find_companion("notes/Paper.md", root, &[]);
        assert_eq!(result, Some("notes/Paper.pdf".to_string()));
    }

    #[test]
    fn find_companion_returns_none_for_unsupported_extension() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("paper.txt"), "x").unwrap();
        assert_eq!(find_companion("paper.txt", root, &[]), None);
    }

    #[cfg(unix)]
    #[test]
    fn find_companion_follows_symlink_outside_root() {
        let workspace = tempfile::tempdir().unwrap();
        let root = workspace.path();
        let external = tempfile::tempdir().unwrap();
        std::fs::write(root.join("paper.md"), "x").unwrap();
        std::fs::write(external.path().join("paper.pdf"), "x").unwrap();
        std::os::unix::fs::symlink(
            external.path().join("paper.pdf"),
            root.join("paper.pdf"),
        )
        .unwrap();
        assert_eq!(
            find_companion("paper.md", root, &[]),
            Some("paper.pdf".to_string())
        );
    }

    #[test]
    fn find_companion_via_absolute_search_path() {
        let workspace = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        let root = workspace.path();
        std::fs::write(root.join("paper.md"), "x").unwrap();
        std::fs::write(external.path().join("paper.pdf"), "x").unwrap();
        let ext_str = external.path().to_str().unwrap().to_string();
        let result = find_companion("paper.md", root, &[ext_str]);
        assert!(result.is_some());
        let path = result.unwrap();
        assert!(path.starts_with('/'), "expected absolute path, got: {path}");
        assert!(path.ends_with("paper.pdf"));
    }

    #[test]
    fn find_window_for_workspace_returns_none_for_empty_registry() {
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(HashMap::new()),
        };
        assert_eq!(registry.find_window_for_workspace(Path::new("/my/vault")), None);
    }

    #[test]
    fn find_window_for_workspace_returns_label_for_matching_path() {
        let mut map = HashMap::new();
        map.insert(
            "win-1".to_string(),
            WorkspaceEntry {
                root: PathBuf::from("/my/vault"),
                watcher: None,
                companion_reverse_map: HashMap::new(),
            },
        );
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(map),
        };
        assert_eq!(
            registry.find_window_for_workspace(Path::new("/my/vault")),
            Some("win-1".to_string())
        );
    }

    #[test]
    fn find_window_for_workspace_returns_none_for_non_matching_path() {
        let mut map = HashMap::new();
        map.insert(
            "win-1".to_string(),
            WorkspaceEntry {
                root: PathBuf::from("/my/vault"),
                watcher: None,
                companion_reverse_map: HashMap::new(),
            },
        );
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(map),
        };
        assert_eq!(
            registry.find_window_for_workspace(Path::new("/other/vault")),
            None
        );
    }

    #[test]
    fn find_window_for_workspace_matches_via_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let non_canonical = dir.path().to_path_buf();
        let canonical = dir.path().canonicalize().unwrap();

        let mut map = HashMap::new();
        map.insert(
            "win-1".to_string(),
            WorkspaceEntry {
                root: non_canonical,
                watcher: None,
                companion_reverse_map: HashMap::new(),
            },
        );
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(map),
        };
        assert_eq!(
            registry.find_window_for_workspace(&canonical),
            Some("win-1".to_string())
        );
    }

    #[test]
    fn find_window_for_workspace_matches_stored_canonical_looked_up_non_canonical() {
        let dir = tempfile::tempdir().unwrap();
        let non_canonical = dir.path().to_path_buf();
        let canonical = dir.path().canonicalize().unwrap();

        let mut map = HashMap::new();
        map.insert(
            "win-1".to_string(),
            WorkspaceEntry {
                root: canonical,
                watcher: None,
                companion_reverse_map: HashMap::new(),
            },
        );
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(map),
        };
        assert_eq!(
            registry.find_window_for_workspace(&non_canonical),
            Some("win-1".to_string())
        );
    }

    #[test]
    fn find_window_for_workspace_falls_back_to_direct_comparison_when_path_deleted() {
        let mut map = HashMap::new();
        map.insert(
            "win-1".to_string(),
            WorkspaceEntry {
                root: PathBuf::from("/nonexistent/path"),
                watcher: None,
                companion_reverse_map: HashMap::new(),
            },
        );
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(map),
        };
        assert_eq!(
            registry.find_window_for_workspace(Path::new("/nonexistent/path")),
            Some("win-1".to_string())
        );
    }

    #[test]
    fn annotate_companions_sets_true_for_md_with_pdf_sibling() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("paper.md"), "x").unwrap();
        std::fs::write(root.join("paper.pdf"), "x").unwrap();

        let mut pages = vec![PageMeta {
            title: "paper".to_string(),
            relative_path: "paper.md".to_string(),
            frontmatter: IndexMap::new(),
            created_at: None,
            modified_at: None,
            file_type: crate::workspace::page::FileType::Markdown,
            has_companion: false,
        }];
        let _ = annotate_companions(&mut pages, root, &[]);
        assert!(pages[0].has_companion);
    }

    #[test]
    fn annotate_companions_sets_true_for_pdf_with_md_sibling() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("paper.md"), "x").unwrap();
        std::fs::write(root.join("paper.pdf"), "x").unwrap();

        let mut pages = vec![PageMeta {
            title: "paper".to_string(),
            relative_path: "paper.pdf".to_string(),
            frontmatter: IndexMap::new(),
            created_at: None,
            modified_at: None,
            file_type: crate::workspace::page::FileType::Pdf,
            has_companion: false,
        }];
        let _ = annotate_companions(&mut pages, root, &[]);
        assert!(pages[0].has_companion);
    }

    #[test]
    fn annotate_companions_remains_false_when_no_companion() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("paper.md"), "x").unwrap();

        let mut pages = vec![PageMeta {
            title: "paper".to_string(),
            relative_path: "paper.md".to_string(),
            frontmatter: IndexMap::new(),
            created_at: None,
            modified_at: None,
            file_type: crate::workspace::page::FileType::Markdown,
            has_companion: false,
        }];
        let _ = annotate_companions(&mut pages, root, &[]);
        assert!(!pages[0].has_companion);
    }

    #[test]
    fn annotate_companions_via_search_path() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::create_dir_all(root.join("pdfs")).unwrap();
        std::fs::write(root.join("notes/paper.md"), "x").unwrap();
        std::fs::write(root.join("pdfs/paper.pdf"), "x").unwrap();

        let mut pages = vec![PageMeta {
            title: "paper".to_string(),
            relative_path: "notes/paper.md".to_string(),
            frontmatter: IndexMap::new(),
            created_at: None,
            modified_at: None,
            file_type: crate::workspace::page::FileType::Markdown,
            has_companion: false,
        }];
        let _ = annotate_companions(&mut pages, root, &["pdfs".to_string()]);
        assert!(pages[0].has_companion);
    }

    #[test]
    fn find_companion_uses_frontmatter_companion() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets/pdf")).unwrap();
        std::fs::write(
            root.join("paper.md"),
            "---\ncompanion: assets/pdf/paper-trimmed.pdf\n---\nContent\n",
        )
        .unwrap();
        std::fs::write(root.join("assets/pdf/paper-trimmed.pdf"), b"trimmed").unwrap();
        std::fs::write(root.join("paper.pdf"), b"original").unwrap();
        assert_eq!(
            find_companion("paper.md", root, &[]),
            Some("assets/pdf/paper-trimmed.pdf".to_string())
        );
    }

    #[test]
    fn find_companion_falls_back_when_frontmatter_target_missing() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(
            root.join("paper.md"),
            "---\ncompanion: assets/pdf/paper-trimmed.pdf\n---\nContent\n",
        )
        .unwrap();
        std::fs::write(root.join("paper.pdf"), b"sibling").unwrap();
        assert_eq!(
            find_companion("paper.md", root, &[]),
            Some("paper.pdf".to_string())
        );
    }

    #[test]
    fn find_companion_frontmatter_not_checked_for_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("paper.md"), "---\ncompanion: other.pdf\n---\n").unwrap();
        std::fs::write(root.join("paper.pdf"), b"pdf").unwrap();
        std::fs::write(root.join("other.pdf"), b"other").unwrap();
        assert_eq!(
            find_companion("paper.pdf", root, &[]),
            Some("paper.md".to_string())
        );
    }

    #[test]
    fn find_companion_frontmatter_no_companion_key() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(
            root.join("paper.md"),
            "---\ntitle: Test\n---\nContent\n",
        )
        .unwrap();
        std::fs::write(root.join("paper.pdf"), b"pdf").unwrap();
        assert_eq!(
            find_companion("paper.md", root, &[]),
            Some("paper.pdf".to_string())
        );
    }

    fn page(relative_path: &str, file_type: crate::workspace::page::FileType) -> PageMeta {
        PageMeta {
            title: relative_path.to_string(),
            relative_path: relative_path.to_string(),
            frontmatter: IndexMap::new(),
            created_at: None,
            modified_at: None,
            file_type,
            has_companion: false,
        }
    }

    // ---- reverse_map_contains_pdf ----

    #[test]
    fn reverse_map_contains_pdf_returns_true_for_mapped_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets/pdf")).unwrap();
        std::fs::write(root.join("assets/pdf/paper.pdf"), b"pdf").unwrap();

        let mut map = HashMap::new();
        let canon = root.join("assets/pdf/paper.pdf").canonicalize().unwrap();
        map.insert(canon, "note.md".to_string());

        assert!(reverse_map_contains_pdf(root, "assets/pdf/paper.pdf", &map));
    }

    #[test]
    fn reverse_map_contains_pdf_returns_false_for_unmapped_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets/pdf")).unwrap();
        std::fs::write(root.join("assets/pdf/paper.pdf"), b"pdf").unwrap();

        let map: HashMap<PathBuf, String> = HashMap::new();

        assert!(!reverse_map_contains_pdf(root, "assets/pdf/paper.pdf", &map));
    }

    #[test]
    fn reverse_map_contains_pdf_returns_false_for_nonexistent_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        let mut map = HashMap::new();
        // Insert a dummy key so map is non-empty.
        map.insert(PathBuf::from("/nonexistent/dummy.pdf"), "note.md".to_string());

        assert!(!reverse_map_contains_pdf(root, "no-such-file.pdf", &map));
    }

    // ---- reverse_companion_lookup ----

    #[test]
    fn reverse_companion_lookup_finds_md_for_mapped_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets/pdf")).unwrap();
        std::fs::write(root.join("assets/pdf/ref61-1.pdf"), b"pdf").unwrap();
        std::fs::write(root.join("note.md"), b"x").unwrap();

        let mut map = HashMap::new();
        let canon = root.join("assets/pdf/ref61-1.pdf").canonicalize().unwrap();
        map.insert(canon, "note.md".to_string());

        assert_eq!(
            reverse_companion_lookup(root, "assets/pdf/ref61-1.pdf", &map),
            Some("note.md".to_string())
        );
    }

    #[test]
    fn reverse_companion_lookup_returns_none_for_unmapped_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets/pdf")).unwrap();
        std::fs::write(root.join("assets/pdf/ref61-1.pdf"), b"pdf").unwrap();

        let map = HashMap::new();
        assert_eq!(
            reverse_companion_lookup(root, "assets/pdf/ref61-1.pdf", &map),
            None
        );
    }

    #[test]
    fn reverse_companion_lookup_returns_canonicalized_path() {
        // The map stores a non-canonical-cased md path; the lookup should route
        // it through canonicalize_within_root and recover the on-disk casing.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets/pdf")).unwrap();
        std::fs::write(root.join("assets/pdf/ref61-1.pdf"), b"pdf").unwrap();
        std::fs::write(root.join("Note.md"), b"x").unwrap();

        let mut map = HashMap::new();
        let canon = root.join("assets/pdf/ref61-1.pdf").canonicalize().unwrap();
        map.insert(canon, "Note.md".to_string());

        assert_eq!(
            reverse_companion_lookup(root, "assets/pdf/ref61-1.pdf", &map),
            Some("Note.md".to_string())
        );
    }

    // ---- annotate_companions reverse map ----

    #[test]
    fn annotate_companions_returns_reverse_map_from_frontmatter() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets/pdf")).unwrap();
        std::fs::write(
            root.join("note.md"),
            "---\ncompanion: assets/pdf/ref61-1.pdf\n---\nContent\n",
        )
        .unwrap();
        std::fs::write(root.join("assets/pdf/ref61-1.pdf"), b"pdf").unwrap();

        let mut pages = vec![
            page("note.md", crate::workspace::page::FileType::Markdown),
            page("assets/pdf/ref61-1.pdf", crate::workspace::page::FileType::Pdf),
        ];
        let map = annotate_companions(&mut pages, root, &[]);

        let canon = root.join("assets/pdf/ref61-1.pdf").canonicalize().unwrap();
        assert_eq!(map.get(&canon), Some(&"note.md".to_string()));
        assert!(pages[0].has_companion, "md page should have companion");
        assert!(pages[1].has_companion, "pdf page should have companion");
    }

    #[test]
    fn annotate_companions_reverse_map_first_md_wins() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets/pdf")).unwrap();
        std::fs::write(root.join("assets/pdf/shared.pdf"), b"pdf").unwrap();
        std::fs::write(
            root.join("aaa.md"),
            "---\ncompanion: assets/pdf/shared.pdf\n---\n",
        )
        .unwrap();
        std::fs::write(
            root.join("bbb.md"),
            "---\ncompanion: assets/pdf/shared.pdf\n---\n",
        )
        .unwrap();

        // Pages pre-sorted by relative_path (as scan_pages produces).
        let mut pages = vec![
            page("aaa.md", crate::workspace::page::FileType::Markdown),
            page("bbb.md", crate::workspace::page::FileType::Markdown),
        ];
        let map = annotate_companions(&mut pages, root, &[]);

        let canon = root.join("assets/pdf/shared.pdf").canonicalize().unwrap();
        assert_eq!(map.get(&canon), Some(&"aaa.md".to_string()));
    }

    #[test]
    fn annotate_companions_reverse_map_first_md_wins_regardless_of_input_order() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets/pdf")).unwrap();
        std::fs::write(root.join("assets/pdf/shared.pdf"), b"pdf").unwrap();
        std::fs::write(
            root.join("aaa.md"),
            "---\ncompanion: assets/pdf/shared.pdf\n---\n",
        )
        .unwrap();
        std::fs::write(
            root.join("bbb.md"),
            "---\ncompanion: assets/pdf/shared.pdf\n---\n",
        )
        .unwrap();

        // Deliberately reverse-sorted: bbb before aaa.
        let mut pages = vec![
            page("bbb.md", crate::workspace::page::FileType::Markdown),
            page("aaa.md", crate::workspace::page::FileType::Markdown),
        ];
        let map = annotate_companions(&mut pages, root, &[]);

        let canon = root.join("assets/pdf/shared.pdf").canonicalize().unwrap();
        assert_eq!(
            map.get(&canon),
            Some(&"aaa.md".to_string()),
            "aaa.md should win even when bbb.md appears first in input",
        );
    }

    #[test]
    fn annotate_companions_pdf_gets_has_companion_via_reverse_map() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets/pdf")).unwrap();
        // md declares a differently-named PDF; no same-name sibling exists.
        std::fs::write(
            root.join("note.md"),
            "---\ncompanion: assets/pdf/ref61-1.pdf\n---\n",
        )
        .unwrap();
        std::fs::write(root.join("assets/pdf/ref61-1.pdf"), b"pdf").unwrap();

        let mut pages = vec![
            page("note.md", crate::workspace::page::FileType::Markdown),
            page("assets/pdf/ref61-1.pdf", crate::workspace::page::FileType::Pdf),
        ];
        let _ = annotate_companions(&mut pages, root, &[]);

        // The PDF has no same-name md sibling, so phase 2 (reverse map) flags it.
        assert!(pages[1].has_companion);
    }

    #[test]
    fn reverse_lookup_end_to_end_pdf_to_md_via_frontmatter() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets/pdf")).unwrap();
        std::fs::write(
            root.join("the-entropy-of-hawking-radiation-ref61.md"),
            "---\ncompanion: assets/pdf/ref61-1.pdf\n---\nNotes\n",
        )
        .unwrap();
        std::fs::write(root.join("assets/pdf/ref61-1.pdf"), b"pdf").unwrap();

        let mut pages = vec![
            page(
                "the-entropy-of-hawking-radiation-ref61.md",
                crate::workspace::page::FileType::Markdown,
            ),
            page("assets/pdf/ref61-1.pdf", crate::workspace::page::FileType::Pdf),
        ];
        let map = annotate_companions(&mut pages, root, &[]);

        // No same-name sibling, so the forward lookup finds nothing.
        assert_eq!(find_companion("assets/pdf/ref61-1.pdf", root, &[]), None);
        // The reverse map resolves the PDF back to the declaring md note.
        assert_eq!(
            reverse_companion_lookup(root, "assets/pdf/ref61-1.pdf", &map),
            Some("the-entropy-of-hawking-radiation-ref61.md".to_string())
        );
        // And the PDF page is flagged as having a companion.
        assert!(pages[1].has_companion);
    }

    #[test]
    fn find_companion_same_name_wins_over_reverse_frontmatter() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets/pdf")).unwrap();
        // A note declares paper.pdf as its companion via frontmatter...
        std::fs::write(
            root.join("notes.md"),
            "---\ncompanion: assets/pdf/paper.pdf\n---\n",
        )
        .unwrap();
        std::fs::write(root.join("assets/pdf/paper.pdf"), b"pdf").unwrap();
        // ...but a same-name sibling assets/pdf/paper.md also exists.
        std::fs::write(root.join("assets/pdf/paper.md"), b"x").unwrap();

        // Forward lookup must prefer the same-name sibling.
        assert_eq!(
            find_companion("assets/pdf/paper.pdf", root, &[]),
            Some("assets/pdf/paper.md".to_string())
        );
    }

    // ---- find_companion_by_sibling ----

    #[test]
    fn find_companion_by_sibling_does_not_check_frontmatter() {
        // A markdown file with a `companion:` frontmatter pointing to custom.pdf,
        // but no same-name sibling paper.pdf. The sibling-only helper must return
        // None because it never reads frontmatter.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(
            root.join("paper.md"),
            "---\ncompanion: custom.pdf\n---\nContent\n",
        )
        .unwrap();
        std::fs::write(root.join("custom.pdf"), b"pdf").unwrap();

        // Sibling-only: no same-name paper.pdf, so None.
        assert_eq!(
            find_companion_by_sibling("paper.md", root, &[]),
            None,
        );
        // Full find_companion reads frontmatter and finds custom.pdf.
        assert_eq!(
            find_companion("paper.md", root, &[]),
            Some("custom.pdf".to_string()),
        );
    }

    #[test]
    fn find_companion_by_sibling_finds_same_name_sibling() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("paper.md"), "x").unwrap();
        std::fs::write(root.join("paper.pdf"), "x").unwrap();

        assert_eq!(
            find_companion_by_sibling("paper.md", root, &[]),
            Some("paper.pdf".to_string()),
        );
    }

    // ---- get_workspace_root_and_reverse_map ----

    #[test]
    fn snapshot_returns_consistent_root_and_map() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let mut reverse_map = HashMap::new();
        reverse_map.insert(
            root.join("assets/paper.pdf"),
            "note.md".to_string(),
        );
        let mut map = HashMap::new();
        map.insert(
            "win".to_string(),
            WorkspaceEntry {
                root: root.clone(),
                watcher: None,
                companion_reverse_map: reverse_map.clone(),
            },
        );
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(map),
        };

        let (snap_root, snap_map) =
            get_workspace_root_and_reverse_map(&registry, "win").unwrap();
        assert_eq!(snap_root, root);
        assert_eq!(snap_map, reverse_map);
    }

    #[test]
    fn snapshot_is_not_affected_by_later_workspace_swap() {
        let dir_a = tempfile::tempdir().unwrap();
        let dir_b = tempfile::tempdir().unwrap();
        let root_a = dir_a.path().to_path_buf();
        let root_b = dir_b.path().to_path_buf();

        let mut map_a = HashMap::new();
        map_a.insert(root_a.join("a.pdf"), "a.md".to_string());

        let mut map_b = HashMap::new();
        map_b.insert(root_b.join("b.pdf"), "b.md".to_string());

        let mut entries = HashMap::new();
        entries.insert(
            "win".to_string(),
            WorkspaceEntry {
                root: root_a.clone(),
                watcher: None,
                companion_reverse_map: map_a.clone(),
            },
        );
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(entries),
        };

        // Take the snapshot (simulates the single lock in find_companion_file).
        let (snap_root, snap_map) =
            get_workspace_root_and_reverse_map(&registry, "win").unwrap();

        // Now simulate open_workspace replacing the entry.
        registry.workspaces.lock().unwrap().insert(
            "win".to_string(),
            WorkspaceEntry {
                root: root_b.clone(),
                watcher: None,
                companion_reverse_map: map_b.clone(),
            },
        );

        // The snapshot is still from workspace A — root and map are consistent.
        assert_eq!(snap_root, root_a);
        assert_eq!(snap_map, map_a);
        // Importantly, snap_root is NOT root_b and snap_map is NOT map_b.
        assert_ne!(snap_root, root_b);
        assert_ne!(snap_map, map_b);
    }

    #[test]
    fn snapshot_returns_error_for_unknown_label() {
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(HashMap::new()),
        };
        let result = get_workspace_root_and_reverse_map(&registry, "unknown");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown"));
    }

    #[test]
    fn find_companion_by_sibling_finds_via_search_path() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::create_dir_all(root.join("pdfs")).unwrap();
        std::fs::write(root.join("notes/paper.md"), "x").unwrap();
        std::fs::write(root.join("pdfs/paper.pdf"), "x").unwrap();

        assert_eq!(
            find_companion_by_sibling("notes/paper.md", root, &["pdfs".to_string()]),
            Some("pdfs/paper.pdf".to_string()),
        );
    }

    #[test]
    fn annotate_companions_frontmatter_companion_populates_reverse_map_and_has_companion() {
        // Verifies that annotate_companions populates both has_companion and the
        // reverse map from a single frontmatter read, without relying on sibling
        // logic.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets/pdf")).unwrap();
        std::fs::write(
            root.join("note.md"),
            "---\ncompanion: assets/pdf/paper.pdf\n---\nContent\n",
        )
        .unwrap();
        std::fs::write(root.join("assets/pdf/paper.pdf"), b"pdf").unwrap();
        // Crucially: no same-name sibling note.pdf exists.

        let mut pages = vec![
            page("note.md", crate::workspace::page::FileType::Markdown),
            page("assets/pdf/paper.pdf", crate::workspace::page::FileType::Pdf),
        ];
        let map = annotate_companions(&mut pages, root, &[]);

        // md page flagged via frontmatter companion.
        assert!(pages[0].has_companion, "md page should have companion from frontmatter");
        // PDF page flagged via phase 2 reverse map.
        assert!(pages[1].has_companion, "pdf page should have companion via reverse map");
        // Reverse map contains the canonical PDF path pointing to the md.
        let canon = root.join("assets/pdf/paper.pdf").canonicalize().unwrap();
        assert_eq!(map.get(&canon), Some(&"note.md".to_string()));

        // Confirm sibling-only helper returns None for note.md (no note.pdf sibling).
        assert_eq!(
            find_companion_by_sibling("note.md", root, &[]),
            None,
            "sibling helper should return None for frontmatter-only companion",
        );
    }

    #[test]
    fn reverse_lookup_skipped_for_non_pdf_extension() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("note.md"), "no companion").unwrap();

        // Rig the reverse map so that note.md's canonical path maps to something.
        // This would be a false positive if the guard were missing.
        let mut map = HashMap::new();
        let canon = root.join("note.md").canonicalize().unwrap();
        map.insert(canon, "other.md".to_string());

        // Forward lookup returns None (no note.pdf sibling, no frontmatter companion).
        assert_eq!(find_companion("note.md", root, &[]), None);

        // The reverse map DOES contain note.md if we look it up directly...
        assert!(reverse_companion_lookup(root, "note.md", &map).is_some());

        // ...but a .md path should never reach the reverse lookup.
        // Simulate the guarded logic from find_companion_file:
        let relative_path = "note.md";
        let result = if relative_path.to_ascii_lowercase().ends_with(".pdf") {
            reverse_companion_lookup(root, relative_path, &map)
        } else {
            None
        };
        assert_eq!(result, None, ".md path must not consult the reverse map");
    }

    #[test]
    fn reverse_lookup_reached_for_pdf_extension() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(root.join("assets/paper.pdf"), b"pdf").unwrap();
        std::fs::write(root.join("note.md"), b"x").unwrap();

        let mut map = HashMap::new();
        let canon = root.join("assets/paper.pdf").canonicalize().unwrap();
        map.insert(canon, "note.md".to_string());

        // Forward lookup returns None (no assets/paper.md sibling).
        assert_eq!(find_companion("assets/paper.pdf", root, &[]), None);

        // With the .pdf guard, the reverse lookup IS reached.
        let relative_path = "assets/paper.pdf";
        let result = if relative_path.to_ascii_lowercase().ends_with(".pdf") {
            reverse_companion_lookup(root, relative_path, &map)
        } else {
            None
        };
        assert_eq!(result, Some("note.md".to_string()));
    }

    /// Characterization test: for non-PDF inputs, only the root is needed from
    /// the registry. `get_workspace_root` returns the same root value as the
    /// combined `get_workspace_root_and_reverse_map`, and `find_companion`
    /// produces identical results with either root. This pins the optimization
    /// that avoids cloning the reverse map for non-PDF callers.
    #[test]
    fn non_pdf_uses_root_only_lookup() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        // Create a markdown file and its PDF sibling so find_companion succeeds.
        std::fs::write(root.join("note.md"), "content").unwrap();
        std::fs::write(root.join("note.pdf"), b"pdf").unwrap();

        // Populate the registry with a reverse map that has entries (to prove
        // it is not consulted for non-PDF inputs).
        let mut reverse_map = HashMap::new();
        let canon = root.join("note.pdf").canonicalize().unwrap();
        reverse_map.insert(canon, "note.md".to_string());

        let mut entries = HashMap::new();
        entries.insert(
            "win".to_string(),
            WorkspaceEntry {
                root: root.to_path_buf(),
                watcher: None,
                companion_reverse_map: reverse_map,
            },
        );
        let registry = WorkspaceRegistry {
            workspaces: Mutex::new(entries),
        };

        // Root-only lookup returns the same root as the combined snapshot.
        let root_only = get_workspace_root(&registry, "win").unwrap();
        let (root_combined, _map) =
            get_workspace_root_and_reverse_map(&registry, "win").unwrap();
        assert_eq!(root_only, root_combined, "root-only and combined snapshot must agree on root");

        // find_companion using root-only returns the same result as with the
        // combined root — proving non-PDF callers need only the root.
        let result_root_only = find_companion("note.md", &root_only, &[]);
        let result_combined = find_companion("note.md", &root_combined, &[]);
        assert_eq!(result_root_only, result_combined);
        assert!(result_root_only.is_some(), "md file should find its PDF sibling");

        // Confirm a non-PDF relative_path never needs the reverse map.
        let relative_path = "note.md";
        let is_pdf = relative_path.to_ascii_lowercase().ends_with(".pdf");
        assert!(!is_pdf, "note.md must not be classified as PDF");
    }
}
