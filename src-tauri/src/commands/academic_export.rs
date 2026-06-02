use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{Emitter, Manager};

use crate::preferences;
use super::workspace::{get_workspace_root, WorkspaceRegistry};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PandocInfo {
    pub pandoc_path: String,
    pub pandoc_version: String,
    pub crossref_path: Option<String>,
    pub crossref_version: Option<String>,
    pub pdf_engines: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExportRequest {
    pub relative_path: String,
    pub output_path: String,
    pub format: String,
    pub csl: Option<String>,
    pub template: Option<String>,
    pub reference_doc: Option<String>,
    pub pdf_engine: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AcademicExportProgress {
    pub stage: String,
    pub format: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportResult {
    pub output_path: String,
    pub success: bool,
    pub stderr: String,
    pub latex_errors: Vec<LatexError>,
}

#[derive(Debug, Default, PartialEq)]
pub struct ExportFrontmatter {
    pub csl: Option<String>,
    pub template: Option<String>,
    pub reference_doc: Option<String>,
    pub pdf_engine: Option<String>,
    pub cjk_mainfont: Option<String>,
}

/// Returns true if `text` contains any CJK characters (Chinese, Japanese, Korean).
pub fn contains_cjk(text: &str) -> bool {
    text.chars().any(|c| matches!(c,
        // CJK Symbols and Punctuation
        '\u{3000}'..='\u{303F}' |
        // Hiragana
        '\u{3040}'..='\u{309F}' |
        // Katakana
        '\u{30A0}'..='\u{30FF}' |
        // CJK Unified Ideographs Extension A
        '\u{3400}'..='\u{4DBF}' |
        // CJK Unified Ideographs
        '\u{4E00}'..='\u{9FFF}' |
        // Hangul Syllables
        '\u{AC00}'..='\u{D7AF}' |
        // Halfwidth and Fullwidth Forms
        '\u{FF00}'..='\u{FFEF}' |
        // CJK Unified Ideographs Extension B
        '\u{20000}'..='\u{2A6DF}'
    ))
}

/// Returns the platform-appropriate default CJK font.
pub fn default_cjk_font() -> &'static str {
    if cfg!(target_os = "macos") {
        "PingFang SC"
    } else {
        "Noto Sans CJK SC"
    }
}

/// Resolve which CJK font (if any) to inject as a pandoc variable.
///
/// Returns `None` when the frontmatter already specifies `CJKmainfont` (pandoc
/// reads it natively). Otherwise checks the user preference, then auto-detects
/// from content.
pub fn resolve_cjk_font(
    frontmatter_cjk: Option<&str>,
    prefs: &preferences::Preferences,
    content: &str,
) -> Option<String> {
    if frontmatter_cjk.is_some() {
        return None;
    }
    if let Some(val) = prefs.extra.get("academic.cjkFont") {
        if let Some(s) = val.as_str() {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    if contains_cjk(content) {
        return Some(default_cjk_font().to_string());
    }
    None
}

pub fn extract_export_frontmatter(file_path: &Path) -> ExportFrontmatter {
    let raw = match std::fs::read_to_string(file_path) {
        Ok(s) => s,
        Err(_) => return ExportFrontmatter::default(),
    };
    let parsed = crate::workspace::frontmatter::parse_frontmatter(&raw);
    let get_str = |key: &str| -> Option<String> {
        parsed.map.get(key).and_then(|v| match v {
            serde_yaml::Value::String(s) => Some(s.clone()),
            _ => None,
        })
    };
    ExportFrontmatter {
        csl: get_str("csl"),
        template: get_str("template"),
        reference_doc: get_str("reference-doc"),
        pdf_engine: get_str("pdf-engine"),
        cjk_mainfont: get_str("CJKmainfont"),
    }
}

/// Scan directories in PATH for a binary with the given name.
pub fn find_in_path(binary_name: &str) -> Option<PathBuf> {
    let path_var = std::env::var("PATH").unwrap_or_default();
    let extra_dirs: &[&str] = if cfg!(target_os = "macos") {
        &[
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/Library/TeX/texbin",
        ]
    } else {
        &[]
    };
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(binary_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    for dir in extra_dirs {
        let candidate = Path::new(dir).join(binary_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Run `binary --version` and return the first line of stdout.
pub fn get_version(binary_path: &Path) -> Result<String, String> {
    let output = Command::new(binary_path)
        .arg("--version")
        .output()
        .map_err(|e| format!("failed to run {:?}: {e}", binary_path))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().next().unwrap_or("").trim().to_string();
    if first_line.is_empty() {
        return Err(format!("no version output from {:?}", binary_path));
    }
    Ok(first_line)
}

/// Resolve a binary path: check prefs.extra for a custom path, then fall back
/// to searching PATH. Returns None if the binary is not found anywhere.
pub fn resolve_binary(
    pref_key: &str,
    fallback_name: &str,
    prefs: &preferences::Preferences,
) -> Option<PathBuf> {
    if let Some(val) = prefs.extra.get(pref_key) {
        if let Some(s) = val.as_str() {
            if !s.is_empty() {
                let p = PathBuf::from(s);
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }
    find_in_path(fallback_name)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LatexError {
    pub message: String,
    pub line: Option<u32>,
    pub error_type: String,
}

/// Parse LaTeX/TeX error messages from pandoc stderr output.
pub fn parse_latex_errors(stderr: &str) -> Vec<LatexError> {
    let lines: Vec<&str> = stderr.lines().collect();
    let mut errors = Vec::new();

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if let Some(rest) = line.strip_prefix("! LaTeX Error: ") {
            let message = rest.trim_end_matches('.').trim().to_string();
            let error_type = if rest.contains("not found") {
                "missing_package"
            } else {
                "generic"
            };
            // Look ahead for l.<number> pattern
            let line_number = find_line_number(&lines, i + 1);
            errors.push(LatexError {
                message: format!("{}.", message),
                line: line_number,
                error_type: error_type.to_string(),
            });
        } else if let Some(rest) = line.strip_prefix("! ") {
            // Bare TeX error (not "LaTeX Error")
            let message = rest.trim_end_matches('.').trim().to_string();
            let line_number = find_line_number(&lines, i + 1);
            errors.push(LatexError {
                message: format!("{}.", message),
                line: line_number,
                error_type: "syntax".to_string(),
            });
        }
        i += 1;
    }

    errors
}

/// Look for `l.<number>` pattern in subsequent lines starting from `start`.
fn find_line_number(lines: &[&str], start: usize) -> Option<u32> {
    // Search up to 5 lines ahead for a line number
    for j in start..std::cmp::min(start + 5, lines.len()) {
        let trimmed = lines[j].trim();
        if let Some(rest) = trimmed.strip_prefix("l.") {
            // Extract the number portion
            let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(n) = num_str.parse::<u32>() {
                return Some(n);
            }
        }
    }
    None
}

/// Resolve a CSL name to a path in the bundled resource directory.
fn resolve_csl_name(name: &str, resource_dir: &Path) -> Option<PathBuf> {
    let with_ext = if name.ends_with(".csl") {
        name.to_string()
    } else {
        format!("{name}.csl")
    };
    let path = resource_dir.join("academic").join("csl").join(&with_ext);
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

/// Try to resolve a CSL value: absolute path first, then bundled name.
fn try_resolve_csl(value: &str, resource_dir: Option<&Path>) -> Option<PathBuf> {
    let p = PathBuf::from(value);
    if p.is_absolute() && p.is_file() {
        return Some(p);
    }
    resource_dir.and_then(|rd| resolve_csl_name(value, rd))
}

/// Resolve the CSL style file to use for citation formatting.
/// Priority: request override -> frontmatter -> preference -> bundled default (apa).
pub fn resolve_csl(
    request_override: Option<&str>,
    frontmatter_csl: Option<&str>,
    prefs: &preferences::Preferences,
    resource_dir: Option<&Path>,
) -> Option<PathBuf> {
    if let Some(ov) = request_override {
        if let Some(p) = try_resolve_csl(ov, resource_dir) {
            return Some(p);
        }
    }
    if let Some(fm) = frontmatter_csl {
        if let Some(p) = try_resolve_csl(fm, resource_dir) {
            return Some(p);
        }
    }
    if let Some(val) = prefs.extra.get("academic.defaultCsl") {
        if let Some(s) = val.as_str() {
            if !s.is_empty() {
                if let Some(p) = try_resolve_csl(s, resource_dir) {
                    return Some(p);
                }
            }
        }
    }
    // Fall back to bundled apa.csl
    resource_dir.and_then(|rd| resolve_csl_name("apa", rd))
}

/// Resolve the pandoc template to use.
/// Priority: request override -> frontmatter -> preference.
/// No bundled default — pandoc's own default template handles all commands/packages.
pub fn resolve_template(
    request_override: Option<&str>,
    frontmatter_template: Option<&str>,
    prefs: &preferences::Preferences,
    _resource_dir: Option<&Path>,
    format: &str,
) -> Option<PathBuf> {
    let _ = format;
    let try_path = |value: &str| -> Option<PathBuf> {
        let p = PathBuf::from(value);
        if p.is_file() {
            Some(p)
        } else {
            None
        }
    };

    if let Some(ov) = request_override {
        if let Some(p) = try_path(ov) {
            return Some(p);
        }
    }
    if let Some(fm) = frontmatter_template {
        if let Some(p) = try_path(fm) {
            return Some(p);
        }
    }
    if let Some(val) = prefs.extra.get("academic.defaultTemplate") {
        if let Some(s) = val.as_str() {
            if !s.is_empty() {
                if let Some(p) = try_path(s) {
                    return Some(p);
                }
            }
        }
    }
    None
}

/// Resolve the reference DOCX for pandoc's `--reference-doc` flag.
/// Checks user preferences first, then falls back to a bundled template.
pub fn resolve_reference_doc(
    prefs: &preferences::Preferences,
    resource_dir: Option<&Path>,
) -> Option<PathBuf> {
    if let Some(val) = prefs.extra.get("academic.defaultReferenceDoc") {
        if let Some(s) = val.as_str() {
            if !s.is_empty() {
                let p = PathBuf::from(s);
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }
    resource_dir
        .map(|d| d.join("academic").join("lit-reference.docx"))
        .filter(|p| p.is_file())
}

/// Build the argument list for a pandoc invocation.
pub fn build_pandoc_args(
    input_path: &Path,
    output_path: &Path,
    format: &str,
    resource_path: &Path,
    crossref_path: Option<&Path>,
    pdf_engine: Option<&Path>,
    reference_doc: Option<&Path>,
    csl: Option<&Path>,
    template: Option<&Path>,
) -> Vec<String> {
    let mut args = Vec::new();

    args.push(input_path.to_string_lossy().to_string());

    // For PDF, pandoc infers format from .pdf extension; don't pass -t
    if format != "pdf" {
        args.push("-t".to_string());
        args.push(format.to_string());
    }

    args.push("-o".to_string());
    args.push(output_path.to_string_lossy().to_string());

    // DOCX embeds styles internally; --standalone is not needed (and not supported)
    if format != "docx" {
        args.push("--standalone".to_string());
    }

    args.push("--resource-path".to_string());
    args.push(resource_path.to_string_lossy().to_string());

    if format == "html" {
        args.push("--mathjax".to_string());
    }

    if let Some(crossref) = crossref_path {
        args.push("--filter".to_string());
        args.push(crossref.to_string_lossy().to_string());
    }

    if let Some(csl_path) = csl {
        args.push("--citeproc".to_string());
        args.push(format!("--csl={}", csl_path.to_string_lossy()));
    }

    if let Some(engine) = pdf_engine {
        args.push(format!("--pdf-engine={}", engine.to_string_lossy()));
    }

    if let Some(ref_doc) = reference_doc {
        args.push(format!("--reference-doc={}", ref_doc.to_string_lossy()));
    }

    if let Some(tmpl) = template {
        args.push(format!("--template={}", tmpl.to_string_lossy()));
    } else if format == "pdf" || format == "latex" {
        for var in [
            "geometry:margin=1in",
            "fontsize=12pt",
            "colorlinks=true",
            "linkcolor=blue",
            "citecolor=blue",
            "urlcolor=blue",
            "indent=true",
        ] {
            args.push(format!("--variable={var}"));
        }
    }

    args
}

#[tauri::command]
pub fn detect_pandoc(
    app_handle: tauri::AppHandle,
) -> Result<PandocInfo, String> {
    let prefs = preferences::read_preferences(&app_handle);

    let pandoc_path = resolve_binary("academic.pandocPath", "pandoc", &prefs)
        .ok_or_else(|| "pandoc not found in PATH or preferences".to_string())?;

    let pandoc_version = get_version(&pandoc_path)?;

    let crossref_path = resolve_binary("academic.crossrefFilterPath", "pandoc-crossref", &prefs);
    let crossref_version = crossref_path
        .as_ref()
        .and_then(|p| get_version(p).ok());

    let mut pdf_engines = Vec::new();
    for engine_name in &["xelatex", "lualatex", "pdflatex"] {
        if find_in_path(engine_name).is_some() {
            pdf_engines.push(engine_name.to_string());
        }
    }

    Ok(PandocInfo {
        pandoc_path: pandoc_path.to_string_lossy().to_string(),
        pandoc_version,
        crossref_path: crossref_path.map(|p| p.to_string_lossy().to_string()),
        crossref_version,
        pdf_engines,
    })
}

#[tauri::command]
pub async fn export_document(
    request: ExportRequest,
    window: tauri::Window,
    state: tauri::State<'_, WorkspaceRegistry>,
    app_handle: tauri::AppHandle,
) -> Result<ExportResult, String> {
    let workspace_root = get_workspace_root(&state, window.label())?;
    let input_path = workspace_root.join(&request.relative_path);

    if !input_path.is_file() {
        return Err(format!("Input file not found: {}", input_path.display()));
    }

    let output_path = PathBuf::from(&request.output_path);
    let format = request.format.clone();
    match format.as_str() {
        "latex" | "pdf" | "html" | "docx" => {}
        _ => return Err(format!("unsupported format: {format}")),
    }
    let resource_path = input_path.parent().unwrap_or(&workspace_root).to_path_buf();

    let prefs = preferences::read_preferences(&app_handle);
    let pandoc_path = resolve_binary("academic.pandocPath", "pandoc", &prefs)
        .ok_or_else(|| "pandoc not found".to_string())?;
    let crossref_path = resolve_binary("academic.crossrefFilterPath", "pandoc-crossref", &prefs);

    // Extract frontmatter overrides from the document
    let frontmatter = extract_export_frontmatter(&input_path);

    // Resolve pdf_engine: request -> frontmatter -> preference -> PATH lookup
    let pdf_engine = if format == "pdf" {
        if let Some(ref engine) = request.pdf_engine.as_ref().or(frontmatter.pdf_engine.as_ref()) {
            let p = PathBuf::from(engine);
            if p.is_file() {
                Some(p)
            } else {
                find_in_path(engine)
            }
        } else {
            resolve_binary("academic.pdfEngine", "xelatex", &prefs)
        }
    } else {
        None
    };

    let resource_dir = app_handle.path().resource_dir().ok();

    // Resolve reference doc: request -> frontmatter -> preference -> bundled
    let reference_doc = if format == "docx" {
        if let Some(ref rd) = request.reference_doc.as_ref().or(frontmatter.reference_doc.as_ref()) {
            let p = PathBuf::from(rd);
            if p.is_file() { Some(p) } else { resolve_reference_doc(&prefs, resource_dir.as_deref()) }
        } else {
            resolve_reference_doc(&prefs, resource_dir.as_deref())
        }
    } else {
        None
    };

    // Resolve CSL style
    let csl = resolve_csl(
        request.csl.as_deref(),
        frontmatter.csl.as_deref(),
        &prefs,
        resource_dir.as_deref(),
    );

    // Resolve template
    let template = resolve_template(
        request.template.as_deref(),
        frontmatter.template.as_deref(),
        &prefs,
        resource_dir.as_deref(),
        &format,
    );

    // Resolve CJK font for PDF/LaTeX: frontmatter → preference → auto-detect
    let cjk_font = if format == "pdf" || format == "latex" {
        let content = std::fs::read_to_string(&input_path).unwrap_or_default();
        resolve_cjk_font(frontmatter.cjk_mainfont.as_deref(), &prefs, &content)
    } else {
        None
    };

    let win = window.clone();
    let fmt_for_event = format.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let _ = win.emit("lit:academic-export-progress", AcademicExportProgress {
            stage: "compiling".to_string(),
            format: fmt_for_event.clone(),
        });

        let mut args = build_pandoc_args(
            &input_path,
            &output_path,
            &format,
            &resource_path,
            crossref_path.as_deref(),
            pdf_engine.as_deref(),
            reference_doc.as_deref(),
            csl.as_deref(),
            template.as_deref(),
        );

        if let Some(ref font) = cjk_font {
            args.push(format!("--variable=CJKmainfont={font}"));
        }

        let mut child = Command::new(&pandoc_path)
            .args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to run pandoc: {e}"))?;

        let child_stdout = child.stdout.take();
        let child_stderr = child.stderr.take();

        let stdout_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = child_stdout {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        });

        let stderr_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = child_stderr {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        });

        tracing::debug!(format = %format, "spawned pandoc, draining pipes");

        let timeout = std::time::Duration::from_secs(300);
        let start = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if start.elapsed() >= timeout {
                        let _ = child.kill();
                        let _ = stdout_thread.join();
                        let _ = stderr_thread.join();
                        return Err("pandoc timed out after 5 minutes".to_string());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
                Err(e) => {
                    let _ = child.kill();
                    let _ = stdout_thread.join();
                    let _ = stderr_thread.join();
                    return Err(format!("failed to wait on pandoc: {e}"));
                }
            }
        }

        let status = child.wait()
            .map_err(|e| format!("failed to collect pandoc exit status: {e}"))?;
        let stderr_bytes = stderr_thread.join().unwrap_or_default();
        let _ = stdout_thread.join();

        let stderr = String::from_utf8_lossy(&stderr_bytes).to_string();
        let success = status.success();

        tracing::debug!(stderr_len = stderr_bytes.len(), success, "pandoc finished");

        let latex_errors = if format == "pdf" {
            parse_latex_errors(&stderr)
        } else {
            Vec::new()
        };

        let _ = win.emit("lit:academic-export-progress", AcademicExportProgress {
            stage: "done".to_string(),
            format: fmt_for_event,
        });

        Ok::<ExportResult, String>(ExportResult {
            output_path: request.output_path.clone(),
            success,
            stderr,
            latex_errors,
        })
    })
    .await
    .map_err(|e| format!("task join error: {e}"))??;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_pandoc_args_basic() {
        let args = build_pandoc_args(
            Path::new("/input.md"),
            Path::new("/output.tex"),
            "latex",
            Path::new("/workspace/notes"),
            None,
            None,
            None,
            None,
            None,
        );
        assert!(args.contains(&"-t".to_string()));
        assert!(args.contains(&"latex".to_string()));
        assert!(args.contains(&"-o".to_string()));
        assert!(args.contains(&"/output.tex".to_string()));
        assert!(args.contains(&"--resource-path".to_string()));
        assert!(args.contains(&"--standalone".to_string()));
        assert!(!args.contains(&"--filter".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_with_crossref() {
        let args = build_pandoc_args(
            Path::new("/input.md"),
            Path::new("/output.tex"),
            "latex",
            Path::new("/notes"),
            Some(Path::new("/usr/local/bin/pandoc-crossref")),
            None,
            None,
            None,
            None,
        );
        assert!(args.contains(&"--filter".to_string()));
        assert!(args.contains(&"/usr/local/bin/pandoc-crossref".to_string()));
    }

    #[test]
    fn test_resolve_binary_from_prefs() {
        let tmp = std::env::temp_dir().join("test_pandoc_binary");
        std::fs::write(&tmp, "fake").unwrap();
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.pandocPath".to_string(),
            serde_json::Value::String(tmp.to_string_lossy().to_string()),
        );
        let result = resolve_binary("academic.pandocPath", "nonexistent-binary-xyz", &prefs);
        assert_eq!(result, Some(tmp.clone()));
        std::fs::remove_file(&tmp).unwrap();
    }

    #[test]
    fn test_resolve_binary_ignores_empty_pref() {
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.pandocPath".to_string(),
            serde_json::Value::String("".to_string()),
        );
        let result = resolve_binary("academic.pandocPath", "nonexistent-binary-xyz-12345", &prefs);
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_binary_ignores_nonexistent_pref() {
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.pandocPath".to_string(),
            serde_json::Value::String("/nonexistent/path/to/pandoc".to_string()),
        );
        let result = resolve_binary("academic.pandocPath", "nonexistent-binary-xyz-12345", &prefs);
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_binary_returns_none_when_not_found() {
        let prefs = preferences::Preferences::default();
        let result = resolve_binary("academic.pandocPath", "nonexistent-binary-xyz-12345", &prefs);
        assert!(result.is_none());
    }

    #[test]
    fn test_build_pandoc_args_pdf_format() {
        let args = build_pandoc_args(
            Path::new("/input.md"),
            Path::new("/output.pdf"),
            "pdf",
            Path::new("/workspace/notes"),
            None,
            Some(Path::new("/usr/bin/xelatex")),
            None,
            None,
            None,
        );
        assert!(!args.contains(&"-t".to_string()));
        assert!(args.contains(&"--pdf-engine=/usr/bin/xelatex".to_string()));
        assert!(args.contains(&"-o".to_string()));
        assert!(args.contains(&"--standalone".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_pdf_without_engine() {
        let args = build_pandoc_args(
            Path::new("/input.md"),
            Path::new("/output.pdf"),
            "pdf",
            Path::new("/notes"),
            None,
            None,
            None,
            None,
            None,
        );
        assert!(!args.iter().any(|a| a.starts_with("--pdf-engine")));
        assert!(!args.contains(&"-t".to_string()));
    }

    #[test]
    fn test_pandoc_info_serializes_pdf_engines() {
        let info = PandocInfo {
            pandoc_path: "/usr/bin/pandoc".to_string(),
            pandoc_version: "3.1.9".to_string(),
            crossref_path: None,
            crossref_version: None,
            pdf_engines: vec!["xelatex".to_string()],
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("pdf_engines"));
        assert!(json.contains("xelatex"));
    }

    #[test]
    fn test_parse_latex_errors_empty_stderr() {
        let errors = parse_latex_errors("");
        assert!(errors.is_empty());
    }

    #[test]
    fn test_parse_latex_errors_no_errors() {
        let errors = parse_latex_errors("This is normal output\n");
        assert!(errors.is_empty());
    }

    #[test]
    fn test_parse_latex_errors_generic_error() {
        let stderr = "! LaTeX Error: Something went wrong.\n\nl.42 \\begin{document}\n";
        let errors = parse_latex_errors(stderr);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].message, "Something went wrong.");
        assert_eq!(errors[0].line, Some(42));
        assert_eq!(errors[0].error_type, "generic");
    }

    #[test]
    fn test_parse_latex_errors_missing_package() {
        let stderr = "! LaTeX Error: File `fancyhdr.sty' not found.\n\nl.5 \\usepackage{fancyhdr}\n";
        let errors = parse_latex_errors(stderr);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].error_type, "missing_package");
        assert_eq!(errors[0].line, Some(5));
    }

    #[test]
    fn test_parse_latex_errors_syntax_error() {
        let stderr = "! Undefined control sequence.\nl.10 \\badcommand\n";
        let errors = parse_latex_errors(stderr);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].message, "Undefined control sequence.");
        assert_eq!(errors[0].line, Some(10));
        assert_eq!(errors[0].error_type, "syntax");
    }

    #[test]
    fn test_parse_latex_errors_no_line_number() {
        let stderr = "! LaTeX Error: Some error without line info.\n\n";
        let errors = parse_latex_errors(stderr);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].line, None);
    }

    #[test]
    fn test_parse_latex_errors_multiple_errors() {
        let stderr = "! LaTeX Error: First error.\n\nl.10 ...\n! Undefined control sequence.\nl.20 ...\n";
        let errors = parse_latex_errors(stderr);
        assert_eq!(errors.len(), 2);
    }

    #[test]
    fn test_build_pandoc_args_html_includes_mathjax() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.html"), "html",
            Path::new("/notes"), None, None, None, None, None,
        );
        assert!(args.contains(&"-t".to_string()));
        assert!(args.contains(&"html".to_string()));
        assert!(args.contains(&"--mathjax".to_string()));
        assert!(args.contains(&"--standalone".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_docx_skips_standalone() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.docx"), "docx",
            Path::new("/notes"), None, None, None, None, None,
        );
        assert!(args.contains(&"-t".to_string()));
        assert!(args.contains(&"docx".to_string()));
        assert!(!args.contains(&"--standalone".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_docx_with_reference_doc() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.docx"), "docx",
            Path::new("/notes"), None, None, Some(Path::new("/resources/ref.docx")),
            None, None,
        );
        assert!(args.contains(&"--reference-doc=/resources/ref.docx".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_docx_without_reference_doc() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.docx"), "docx",
            Path::new("/notes"), None, None, None, None, None,
        );
        assert!(!args.iter().any(|a| a.starts_with("--reference-doc")));
    }

    #[test]
    fn test_build_pandoc_args_latex_no_mathjax() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.tex"), "latex",
            Path::new("/notes"), None, None, None, None, None,
        );
        assert!(!args.contains(&"--mathjax".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_pdf_no_mathjax() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.pdf"), "pdf",
            Path::new("/notes"), None, Some(Path::new("/usr/bin/xelatex")), None,
            None, None,
        );
        assert!(!args.contains(&"--mathjax".to_string()));
    }

    #[test]
    fn test_resolve_reference_doc_from_prefs() {
        let tmp = std::env::temp_dir().join("test_ref_doc.docx");
        std::fs::write(&tmp, "fake").unwrap();
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.defaultReferenceDoc".to_string(),
            serde_json::Value::String(tmp.to_string_lossy().to_string()),
        );
        let result = resolve_reference_doc(&prefs, None);
        assert_eq!(result, Some(tmp.clone()));
        std::fs::remove_file(&tmp).unwrap();
    }

    #[test]
    fn test_resolve_reference_doc_returns_none_when_not_found() {
        let prefs = preferences::Preferences::default();
        let result = resolve_reference_doc(&prefs, None);
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_reference_doc_ignores_invalid_pref() {
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.defaultReferenceDoc".to_string(),
            serde_json::Value::String("/nonexistent/ref.docx".to_string()),
        );
        let result = resolve_reference_doc(&prefs, None);
        assert!(result.is_none());
    }

    #[test]
    fn test_build_pandoc_args_with_csl() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.tex"), "latex",
            Path::new("/notes"), None, None, None, Some(Path::new("/styles/ieee.csl")), None,
        );
        assert!(args.contains(&"--citeproc".to_string()));
        assert!(args.contains(&"--csl=/styles/ieee.csl".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_with_template() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.tex"), "latex",
            Path::new("/notes"), None, None, None, None, Some(Path::new("/templates/my.tex")),
        );
        assert!(args.contains(&"--template=/templates/my.tex".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_with_csl_and_template() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.tex"), "latex",
            Path::new("/notes"), None, None, None,
            Some(Path::new("/s/apa.csl")), Some(Path::new("/t/my.tex")),
        );
        assert!(args.contains(&"--citeproc".to_string()));
        assert!(args.contains(&"--csl=/s/apa.csl".to_string()));
        assert!(args.contains(&"--template=/t/my.tex".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_without_csl_no_citeproc() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.tex"), "latex",
            Path::new("/notes"), None, None, None, None, None,
        );
        assert!(!args.contains(&"--citeproc".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_crossref_before_citeproc() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.tex"), "latex",
            Path::new("/notes"),
            Some(Path::new("/usr/local/bin/pandoc-crossref")),
            None, None,
            Some(Path::new("/s/apa.csl")), None,
        );
        let crossref_pos = args.iter().position(|a| a.contains("pandoc-crossref")).unwrap();
        let citeproc_pos = args.iter().position(|a| a == "--citeproc").unwrap();
        assert!(crossref_pos < citeproc_pos, "--filter pandoc-crossref must come before --citeproc");
    }

    fn make_csl_dir(base: &std::path::Path, names: &[&str]) {
        let csl = base.join("academic").join("csl");
        std::fs::create_dir_all(&csl).unwrap();
        for name in names {
            std::fs::write(csl.join(format!("{name}.csl")), "fake").unwrap();
        }
    }

    // CSL resolver tests
    #[test]
    fn test_resolve_csl_request_override_path() {
        let tmp = std::env::temp_dir().join("test_csl_override_path");
        std::fs::create_dir_all(&tmp).unwrap();
        let csl_file = tmp.join("custom.csl");
        std::fs::write(&csl_file, "fake").unwrap();
        let prefs = preferences::Preferences::default();
        let result = resolve_csl(
            Some(&csl_file.to_string_lossy()),
            None,
            &prefs,
            None,
        );
        assert_eq!(result, Some(csl_file));
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn test_resolve_csl_request_override_by_name() {
        let tmp = std::env::temp_dir().join("test_csl_override_name");
        make_csl_dir(&tmp, &["ieee"]);
        let prefs = preferences::Preferences::default();
        let result = resolve_csl(
            Some("ieee"),
            None,
            &prefs,
            Some(&tmp),
        );
        assert_eq!(result, Some(tmp.join("academic/csl/ieee.csl")));
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn test_resolve_csl_frontmatter_over_preference() {
        let tmp = std::env::temp_dir().join("test_csl_fm_over_pref");
        make_csl_dir(&tmp, &["ieee", "apa"]);
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.defaultCsl".to_string(),
            serde_json::Value::String("apa".to_string()),
        );
        let result = resolve_csl(
            None,
            Some("ieee"),
            &prefs,
            Some(&tmp),
        );
        assert_eq!(result, Some(tmp.join("academic/csl/ieee.csl")));
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn test_resolve_csl_preference_by_name() {
        let tmp = std::env::temp_dir().join("test_csl_pref_name");
        make_csl_dir(&tmp, &["chicago-author-date"]);
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.defaultCsl".to_string(),
            serde_json::Value::String("chicago-author-date".to_string()),
        );
        let result = resolve_csl(None, None, &prefs, Some(&tmp));
        assert_eq!(result, Some(tmp.join("academic/csl/chicago-author-date.csl")));
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn test_resolve_csl_falls_back_to_bundled_apa() {
        let tmp = std::env::temp_dir().join("test_csl_fallback_apa");
        make_csl_dir(&tmp, &["apa"]);
        let prefs = preferences::Preferences::default();
        let result = resolve_csl(None, None, &prefs, Some(&tmp));
        assert_eq!(result, Some(tmp.join("academic/csl/apa.csl")));
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn test_resolve_csl_returns_none_when_nothing_found() {
        let prefs = preferences::Preferences::default();
        let result = resolve_csl(None, None, &prefs, None);
        assert!(result.is_none());
    }

    // Template resolver tests
    #[test]
    fn test_resolve_template_for_latex() {
        let prefs = preferences::Preferences::default();
        let result = resolve_template(None, None, &prefs, None, "latex");
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_template_for_pdf() {
        let prefs = preferences::Preferences::default();
        let result = resolve_template(None, None, &prefs, None, "pdf");
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_template_not_for_html() {
        let prefs = preferences::Preferences::default();
        let result = resolve_template(None, None, &prefs, None, "html");
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_template_not_for_docx() {
        let prefs = preferences::Preferences::default();
        let result = resolve_template(None, None, &prefs, None, "docx");
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_template_request_override() {
        let tmp = std::env::temp_dir().join("test_tmpl_override");
        std::fs::create_dir_all(&tmp).unwrap();
        let custom = tmp.join("custom.tex");
        std::fs::write(&custom, "fake").unwrap();
        let prefs = preferences::Preferences::default();
        let result = resolve_template(Some(&custom.to_string_lossy()), None, &prefs, None, "latex");
        assert_eq!(result, Some(custom));
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn test_resolve_template_frontmatter_over_preference() {
        let tmp = std::env::temp_dir().join("test_tmpl_fm_over_pref");
        std::fs::create_dir_all(&tmp).unwrap();
        let fm_tmpl = tmp.join("fm.tex");
        let pref_tmpl = tmp.join("pref.tex");
        std::fs::write(&fm_tmpl, "fake").unwrap();
        std::fs::write(&pref_tmpl, "fake").unwrap();
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.defaultTemplate".to_string(),
            serde_json::Value::String(pref_tmpl.to_string_lossy().to_string()),
        );
        let result = resolve_template(None, Some(&fm_tmpl.to_string_lossy()), &prefs, None, "latex");
        assert_eq!(result, Some(fm_tmpl));
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn test_extract_export_frontmatter_with_all_fields() {
        let dir = std::env::temp_dir().join("test_fm_all");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "---\ncsl: ieee\ntemplate: /my/t.tex\nreference-doc: /r.docx\npdf-engine: lualatex\nCJKmainfont: Noto Serif CJK SC\n---\nBody\n").unwrap();
        let fm = extract_export_frontmatter(&file);
        assert_eq!(fm.csl.as_deref(), Some("ieee"));
        assert_eq!(fm.template.as_deref(), Some("/my/t.tex"));
        assert_eq!(fm.reference_doc.as_deref(), Some("/r.docx"));
        assert_eq!(fm.pdf_engine.as_deref(), Some("lualatex"));
        assert_eq!(fm.cjk_mainfont.as_deref(), Some("Noto Serif CJK SC"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_extract_export_frontmatter_no_frontmatter() {
        let dir = std::env::temp_dir().join("test_fm_empty");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "# Just markdown\n").unwrap();
        let fm = extract_export_frontmatter(&file);
        assert_eq!(fm, ExportFrontmatter::default());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_extract_export_frontmatter_missing_file() {
        let fm = extract_export_frontmatter(Path::new("/nonexistent/file.md"));
        assert_eq!(fm, ExportFrontmatter::default());
    }

    #[test]
    fn test_extract_export_frontmatter_partial() {
        let dir = std::env::temp_dir().join("test_fm_partial");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "---\ncsl: apa\ntitle: Paper\n---\nBody\n").unwrap();
        let fm = extract_export_frontmatter(&file);
        assert_eq!(fm.csl.as_deref(), Some("apa"));
        assert!(fm.template.is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_export_request_deserializes_without_optional_fields() {
        let json = r#"{"relative_path":"a.md","output_path":"/out.tex","format":"latex"}"#;
        let req: ExportRequest = serde_json::from_str(json).unwrap();
        assert!(req.csl.is_none());
        assert!(req.template.is_none());
        assert!(req.reference_doc.is_none());
        assert!(req.pdf_engine.is_none());
    }

    #[test]
    fn test_export_request_deserializes_with_optional_fields() {
        let json = r#"{"relative_path":"a.md","output_path":"/out.pdf","format":"pdf","csl":"apa","template":"/t.tex","reference_doc":"/r.docx","pdf_engine":"lualatex"}"#;
        let req: ExportRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.csl.as_deref(), Some("apa"));
        assert_eq!(req.template.as_deref(), Some("/t.tex"));
        assert_eq!(req.reference_doc.as_deref(), Some("/r.docx"));
        assert_eq!(req.pdf_engine.as_deref(), Some("lualatex"));
    }

    #[test]
    fn test_resolve_reference_doc_falls_back_to_bundled() {
        let tmp_dir = std::env::temp_dir().join("test_resolve_ref_doc_bundled");
        let academic_dir = tmp_dir.join("academic");
        std::fs::create_dir_all(&academic_dir).unwrap();
        let ref_doc = academic_dir.join("lit-reference.docx");
        std::fs::write(&ref_doc, "fake").unwrap();
        let prefs = preferences::Preferences::default();
        let result = resolve_reference_doc(&prefs, Some(&tmp_dir));
        assert_eq!(result, Some(ref_doc));
        std::fs::remove_dir_all(&tmp_dir).unwrap();
    }

    #[test]
    fn test_large_stderr_does_not_deadlock() {
        use std::process::{Command, Stdio};
        use std::io::Read;

        // Spawn a process that writes 200KB to stderr — enough to fill the OS pipe buffer
        let mut child = Command::new("python3")
            .args(["-c", "import sys; sys.stderr.write('x' * 200_000)"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("python3 must be available");

        let child_stdout = child.stdout.take();
        let child_stderr = child.stderr.take();

        let stdout_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = child_stdout {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        });
        let stderr_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = child_stderr {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        });

        let timeout = std::time::Duration::from_secs(10);
        let start = std::time::Instant::now();
        loop {
            match child.try_wait().unwrap() {
                Some(_) => break,
                None => {
                    assert!(start.elapsed() < timeout, "process hung — pipe deadlock");
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
        }

        let status = child.wait().unwrap();
        let stderr_bytes = stderr_thread.join().unwrap();
        let _ = stdout_thread.join();

        assert!(status.success());
        assert_eq!(stderr_bytes.len(), 200_000);
    }

    #[test]
    fn test_timeout_kills_subprocess_with_drain() {
        use std::process::{Command, Stdio};
        use std::io::Read;

        let mut child = Command::new("sleep")
            .arg("3600")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("sleep must be available");

        let child_stdout = child.stdout.take();
        let child_stderr = child.stderr.take();

        let stdout_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = child_stdout {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        });
        let stderr_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = child_stderr {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        });

        let timeout = std::time::Duration::from_secs(1);
        let start = std::time::Instant::now();
        let mut timed_out = false;
        loop {
            match child.try_wait().unwrap() {
                Some(_) => break,
                None => {
                    if start.elapsed() >= timeout {
                        let _ = child.kill();
                        timed_out = true;
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
        }

        let _ = stdout_thread.join();
        let _ = stderr_thread.join();

        assert!(timed_out, "should have timed out after 1 second");
    }

    // --- Default style variable tests ---

    #[test]
    fn test_build_pandoc_args_default_style_variables() {
        for fmt in &["pdf", "latex"] {
            let args = build_pandoc_args(
                Path::new("/input.md"), Path::new("/output"), fmt,
                Path::new("/notes"), None, None, None, None, None,
            );
            assert!(args.contains(&"--variable=geometry:margin=1in".to_string()), "{fmt}: missing geometry");
            assert!(args.contains(&"--variable=fontsize=12pt".to_string()), "{fmt}: missing fontsize");
            assert!(args.contains(&"--variable=colorlinks=true".to_string()), "{fmt}: missing colorlinks");
            assert!(args.contains(&"--variable=linkcolor=blue".to_string()), "{fmt}: missing linkcolor");
            assert!(args.contains(&"--variable=citecolor=blue".to_string()), "{fmt}: missing citecolor");
            assert!(args.contains(&"--variable=urlcolor=blue".to_string()), "{fmt}: missing urlcolor");
            assert!(args.contains(&"--variable=indent=true".to_string()), "{fmt}: missing indent");
        }
    }

    #[test]
    fn test_build_pandoc_args_custom_template_no_variables() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.pdf"), "pdf",
            Path::new("/notes"), None, None, None, None, Some(Path::new("/t/custom.tex")),
        );
        assert!(args.contains(&"--template=/t/custom.tex".to_string()));
        assert!(!args.iter().any(|a| a.starts_with("--variable=")));
    }

    #[test]
    fn test_build_pandoc_args_html_no_variables() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.html"), "html",
            Path::new("/notes"), None, None, None, None, None,
        );
        assert!(!args.iter().any(|a| a.starts_with("--variable=")));
    }

    // --- CJK detection tests ---

    #[test]
    fn test_contains_cjk_empty() {
        assert!(!contains_cjk(""));
    }

    #[test]
    fn test_contains_cjk_ascii_only() {
        assert!(!contains_cjk("Hello, world! This is plain English text."));
    }

    #[test]
    fn test_contains_cjk_chinese() {
        assert!(contains_cjk("这是中文"));
    }

    #[test]
    fn test_contains_cjk_japanese() {
        assert!(contains_cjk("これはテスト"));
    }

    #[test]
    fn test_contains_cjk_korean() {
        assert!(contains_cjk("한국어"));
    }

    #[test]
    fn test_contains_cjk_punctuation() {
        assert!(contains_cjk("。，"));
    }

    #[test]
    fn test_contains_cjk_mixed_with_ascii() {
        assert!(contains_cjk("Hello 世界"));
    }

    #[test]
    fn test_contains_cjk_fullwidth() {
        assert!(contains_cjk("ＡＢＣ"));
    }

    // --- default_cjk_font ---

    #[test]
    fn test_default_cjk_font() {
        let font = default_cjk_font();
        assert!(!font.is_empty());
        if cfg!(target_os = "macos") {
            assert_eq!(font, "PingFang SC");
        } else {
            assert_eq!(font, "Noto Sans CJK SC");
        }
    }

    // --- ExportFrontmatter CJK field ---

    #[test]
    fn test_frontmatter_default_no_cjk() {
        let fm = ExportFrontmatter::default();
        assert!(fm.cjk_mainfont.is_none());
    }

    #[test]
    fn test_extract_frontmatter_cjk_mainfont() {
        let dir = std::env::temp_dir().join("test_fm_cjk");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "---\nCJKmainfont: \"Noto Serif CJK SC\"\n---\nBody\n").unwrap();
        let fm = extract_export_frontmatter(&file);
        assert_eq!(fm.cjk_mainfont.as_deref(), Some("Noto Serif CJK SC"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    // --- resolve_cjk_font tests ---

    #[test]
    fn test_resolve_cjk_font_frontmatter_skips() {
        let prefs = preferences::Preferences::default();
        let result = resolve_cjk_font(Some("PingFang SC"), &prefs, "这是中文");
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_cjk_font_pref_override() {
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.cjkFont".to_string(),
            serde_json::Value::String("Source Han Serif SC".to_string()),
        );
        let result = resolve_cjk_font(None, &prefs, "这是中文");
        assert_eq!(result.as_deref(), Some("Source Han Serif SC"));
    }

    #[test]
    fn test_resolve_cjk_font_auto_detect() {
        let prefs = preferences::Preferences::default();
        let result = resolve_cjk_font(None, &prefs, "Hello 世界");
        assert_eq!(result.as_deref(), Some(default_cjk_font()));
    }

    #[test]
    fn test_resolve_cjk_font_no_cjk_returns_none() {
        let prefs = preferences::Preferences::default();
        let result = resolve_cjk_font(None, &prefs, "Plain ASCII text only.");
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_cjk_font_empty_pref_ignored() {
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.cjkFont".to_string(),
            serde_json::Value::String("".to_string()),
        );
        let result = resolve_cjk_font(None, &prefs, "你好世界");
        assert_eq!(result.as_deref(), Some(default_cjk_font()));
    }
}
