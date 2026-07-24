use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::io::Write as IoWrite;
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
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExportRequest {
    pub relative_path: String,
    pub output_path: String,
    pub format: String,
    pub csl: Option<String>,
    pub template: Option<String>,
    pub reference_doc: Option<String>,
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
}

#[derive(Debug, Default, PartialEq)]
pub struct ExportFrontmatter {
    pub csl: Option<String>,
    pub template: Option<String>,
    pub reference_doc: Option<String>,
    pub cjk_mainfont: Option<String>,
    pub indic_font: Option<String>,
    pub indic_fonts: HashMap<String, String>,
    pub image_dir: Option<String>,
}

// Keep in sync with DEFAULT_IMAGE_DIR in src/lib/imageSrcCandidates.ts
const DEFAULT_IMAGE_DIR: &str = "assets/images";

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum IndicScript {
    Devanagari,
    Bengali,
    Gurmukhi,
    Gujarati,
    Oriya,
    Tamil,
    Telugu,
    Kannada,
    Malayalam,
    Sinhala,
    Thai,
    Lao,
    Tibetan,
    Myanmar,
    Khmer,
    Sharada,
}

impl IndicScript {
    pub fn fontspec_script(&self) -> &'static str {
        match self {
            Self::Devanagari => "Devanagari",
            Self::Bengali => "Bengali",
            Self::Gurmukhi => "Gurmukhi",
            Self::Gujarati => "Gujarati",
            Self::Oriya => "Oriya",
            Self::Tamil => "Tamil",
            Self::Telugu => "Telugu",
            Self::Kannada => "Kannada",
            Self::Malayalam => "Malayalam",
            Self::Sinhala => "Sinhala",
            Self::Thai => "Thai",
            Self::Lao => "Lao",
            Self::Tibetan => "Tibetan",
            Self::Myanmar => "Myanmar",
            Self::Khmer => "Khmer",
            Self::Sharada => "Sharada",
        }
    }

    pub fn default_font(&self) -> &'static str {
        if cfg!(target_os = "macos") {
            match self {
                Self::Devanagari => "Kohinoor Devanagari",
                Self::Bengali => "Noto Sans Bengali",
                Self::Gurmukhi => "Noto Sans Gurmukhi",
                Self::Gujarati => "Noto Sans Gujarati",
                Self::Oriya => "Noto Sans Oriya",
                Self::Tamil => "InaiMathi",
                Self::Telugu => "Noto Sans Telugu",
                Self::Kannada => "Noto Sans Kannada",
                Self::Malayalam => "Noto Sans Malayalam",
                Self::Sinhala => "Noto Sans Sinhala",
                Self::Thai => "Thonburi",
                Self::Lao => "Noto Sans Lao",
                Self::Tibetan => "Kailasa",
                Self::Myanmar => "Noto Sans Myanmar",
                Self::Khmer => "Noto Sans Khmer",
                Self::Sharada => "Noto Sans Sharada",
            }
        } else {
            match self {
                Self::Devanagari => "Noto Sans Devanagari",
                Self::Bengali => "Noto Sans Bengali",
                Self::Gurmukhi => "Noto Sans Gurmukhi",
                Self::Gujarati => "Noto Sans Gujarati",
                Self::Oriya => "Noto Sans Oriya",
                Self::Tamil => "Noto Sans Tamil",
                Self::Telugu => "Noto Sans Telugu",
                Self::Kannada => "Noto Sans Kannada",
                Self::Malayalam => "Noto Sans Malayalam",
                Self::Sinhala => "Noto Sans Sinhala",
                Self::Thai => "Noto Sans Thai",
                Self::Lao => "Noto Sans Lao",
                Self::Tibetan => "Noto Sans Tibetan",
                Self::Myanmar => "Noto Sans Myanmar",
                Self::Khmer => "Noto Sans Khmer",
                Self::Sharada => "Noto Sans Sharada",
            }
        }
    }

    pub fn unicode_ranges(&self) -> &'static [(u32, u32)] {
        match self {
            Self::Devanagari => &[(0x0900, 0x097F), (0xA8E0, 0xA8FF), (0x11B00, 0x11B5F)],
            Self::Bengali => &[(0x0980, 0x09FF)],
            Self::Gurmukhi => &[(0x0A00, 0x0A7F)],
            Self::Gujarati => &[(0x0A80, 0x0AFF)],
            Self::Oriya => &[(0x0B00, 0x0B7F)],
            Self::Tamil => &[(0x0B80, 0x0BFF), (0x11FC0, 0x11FFF)],
            Self::Telugu => &[(0x0C00, 0x0C7F)],
            Self::Kannada => &[(0x0C80, 0x0CFF)],
            Self::Malayalam => &[(0x0D00, 0x0D7F)],
            Self::Sinhala => &[(0x0D80, 0x0DFF)],
            Self::Thai => &[(0x0E00, 0x0E7F)],
            Self::Lao => &[(0x0E80, 0x0EFF)],
            Self::Tibetan => &[(0x0F00, 0x0FFF)],
            Self::Myanmar => &[(0x1000, 0x109F), (0xA9E0, 0xA9FF), (0xAA60, 0xAA7F)],
            Self::Khmer => &[(0x1780, 0x17FF)],
            Self::Sharada => &[(0x11180, 0x111DF)],
        }
    }

    pub fn pref_key(&self) -> &'static str {
        match self {
            Self::Devanagari => "devanagari",
            Self::Bengali => "bengali",
            Self::Gurmukhi => "gurmukhi",
            Self::Gujarati => "gujarati",
            Self::Oriya => "oriya",
            Self::Tamil => "tamil",
            Self::Telugu => "telugu",
            Self::Kannada => "kannada",
            Self::Malayalam => "malayalam",
            Self::Sinhala => "sinhala",
            Self::Thai => "thai",
            Self::Lao => "lao",
            Self::Tibetan => "tibetan",
            Self::Myanmar => "myanmar",
            Self::Khmer => "khmer",
            Self::Sharada => "sharada",
        }
    }

    fn latex_cmd_name(&self) -> &'static str {
        match self {
            Self::Devanagari => "devanagarifont",
            Self::Bengali => "bengalifont",
            Self::Gurmukhi => "gurmukhifont",
            Self::Gujarati => "gujaratifont",
            Self::Oriya => "oriyafont",
            Self::Tamil => "tamilfont",
            Self::Telugu => "telugufont",
            Self::Kannada => "kannadafont",
            Self::Malayalam => "malayalamfont",
            Self::Sinhala => "sinhalafont",
            Self::Thai => "thaifont",
            Self::Lao => "laofont",
            Self::Tibetan => "tibetanfont",
            Self::Myanmar => "myanmarfont",
            Self::Khmer => "khmerfont",
            Self::Sharada => "sharadafont",
        }
    }
}

const ALL_INDIC_SCRIPTS: [IndicScript; 16] = [
    IndicScript::Devanagari,
    IndicScript::Bengali,
    IndicScript::Gurmukhi,
    IndicScript::Gujarati,
    IndicScript::Oriya,
    IndicScript::Tamil,
    IndicScript::Telugu,
    IndicScript::Kannada,
    IndicScript::Malayalam,
    IndicScript::Sinhala,
    IndicScript::Thai,
    IndicScript::Lao,
    IndicScript::Tibetan,
    IndicScript::Myanmar,
    IndicScript::Khmer,
    IndicScript::Sharada,
];

pub fn detect_indic_scripts(text: &str) -> HashSet<IndicScript> {
    let mut found = HashSet::new();
    for c in text.chars() {
        let cp = c as u32;
        for &script in &ALL_INDIC_SCRIPTS {
            if found.contains(&script) {
                continue;
            }
            for &(lo, hi) in script.unicode_ranges() {
                if cp >= lo && cp <= hi {
                    found.insert(script);
                    if found.len() == ALL_INDIC_SCRIPTS.len() {
                        return found;
                    }
                    break;
                }
            }
        }
    }
    found
}

pub fn resolve_indic_fonts(
    detected: &HashSet<IndicScript>,
    frontmatter_indic_font: Option<&str>,
    frontmatter_indic_fonts: &HashMap<String, String>,
    prefs: &preferences::Preferences,
) -> HashMap<IndicScript, String> {
    let mut result = HashMap::new();
    for &script in detected {
        // 1. Frontmatter per-script
        if let Some(font) = frontmatter_indic_fonts.get(script.pref_key()) {
            if !font.is_empty() {
                result.insert(script, font.clone());
                continue;
            }
        }
        // 2. Frontmatter catch-all
        if let Some(font) = frontmatter_indic_font {
            if !font.is_empty() {
                result.insert(script, font.to_string());
                continue;
            }
        }
        // 3. User pref per-script
        let per_script_key = format!("academic.indicFont.{}", script.pref_key());
        if let Some(val) = prefs.extra.get(&per_script_key) {
            if let Some(s) = val.as_str() {
                if !s.is_empty() {
                    result.insert(script, s.to_string());
                    continue;
                }
            }
        }
        // 4. User pref catch-all
        if let Some(val) = prefs.extra.get("academic.indicFont") {
            if let Some(s) = val.as_str() {
                if !s.is_empty() {
                    result.insert(script, s.to_string());
                    continue;
                }
            }
        }
        // 5. Platform default
        result.insert(script, script.default_font().to_string());
    }
    result
}

pub fn build_indic_preamble(
    fonts: &HashMap<IndicScript, String>,
    pdf_engine: Option<&Path>,
) -> std::io::Result<tempfile::NamedTempFile> {
    let mut file = tempfile::Builder::new()
        .prefix("lit-indic-")
        .suffix(".tex")
        .tempfile()?;

    let engine_name = pdf_engine
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("xelatex");

    let is_xelatex = engine_name.contains("xelatex");
    let is_lualatex = engine_name.contains("lualatex");

    if !is_xelatex && !is_lualatex {
        writeln!(file, "% Indic scripts require XeLaTeX or LuaLaTeX — skipped for {engine_name}")?;
        return Ok(file);
    }

    writeln!(file, "% Auto-generated Indic script support")?;
    writeln!(file, "\\usepackage{{fontspec}}")?;

    let mut scripts: Vec<_> = fonts.iter().collect();
    scripts.sort_by_key(|(s, _)| s.pref_key());

    let renderer_opt = if is_xelatex { ",Renderer=HarfBuzz" } else { "" };

    for (script, font) in &scripts {
        writeln!(
            file,
            "\\newfontfamily\\{}[Script={}{}]{{{}}}",
            script.latex_cmd_name(),
            script.fontspec_script(),
            renderer_opt,
            font,
        )?;
    }

    writeln!(file)?;
    writeln!(file, "% Font switching is handled by the Indic Lua filter")?;

    Ok(file)
}

const LUA_FILTER_LOGIC: &str = r#"
local function classify(cp)
  for _, s in ipairs(scripts) do
    for _, r in ipairs(s.ranges) do
      if cp >= r[1] and cp <= r[2] then return s end
    end
  end
  return nil
end

local function latex_escape(s)
  return (s:gsub('[\\#$%%&_{}~^]', function(c)
    if c == '\\' then return '\\textbackslash{}'
    elseif c == '~' then return '\\textasciitilde{}'
    elseif c == '^' then return '\\textasciicircum{}'
    else return '\\' .. c
    end
  end))
end

local function segment(str)
  local segs = {}
  local cur = {}
  local cur_s = nil
  local spaces = {}

  for _, cp in utf8.codes(str) do
    if cp == 0x20 then
      table.insert(spaces, ' ')
    else
      local s = classify(cp)
      if #cur == 0 then
        if #spaces > 0 then
          table.insert(segs, { script = nil, text = table.concat(spaces) })
          spaces = {}
        end
        cur_s = s
      elseif s ~= cur_s then
        table.insert(segs, { script = cur_s, text = table.concat(cur) })
        cur = {}
        if #spaces > 0 then
          table.insert(segs, { script = nil, text = table.concat(spaces) })
          spaces = {}
        end
        cur_s = s
      else
        for i = 1, #spaces do table.insert(cur, ' ') end
        spaces = {}
      end
      table.insert(cur, utf8.char(cp))
    end
  end
  for i = 1, #spaces do table.insert(cur, ' ') end
  if #cur > 0 then
    table.insert(segs, { script = cur_s, text = table.concat(cur) })
  end
  return segs
end

function Str(el)
  local segs = segment(el.text)
  if #segs == 0 then return nil end
  if #segs == 1 and segs[1].script == nil then return nil end
  local result = pandoc.List()
  for _, seg in ipairs(segs) do
    if seg.script then
      result:insert(pandoc.RawInline('latex',
        '{\\' .. seg.script.cmd .. ' ' .. latex_escape(seg.text) .. '}'))
    else
      result:insert(pandoc.Str(seg.text))
    end
  end
  return result
end
"#;

pub fn build_indic_lua_filter(
    fonts: &HashMap<IndicScript, String>,
) -> std::io::Result<tempfile::NamedTempFile> {
    let mut file = tempfile::Builder::new()
        .prefix("lit-indic-")
        .suffix(".lua")
        .tempfile()?;

    let mut scripts: Vec<_> = fonts.keys().collect();
    scripts.sort_by_key(|s| s.pref_key());

    writeln!(file, "-- Auto-generated Indic script font-switching filter")?;
    writeln!(file, "if not FORMAT:match 'latex' then return {{}} end")?;
    writeln!(file)?;
    writeln!(file, "local scripts = {{")?;
    for script in &scripts {
        let ranges = script.unicode_ranges();
        let ranges_lua: Vec<String> = ranges
            .iter()
            .map(|(lo, hi)| format!("{{0x{lo:04X}, 0x{hi:04X}}}"))
            .collect();
        writeln!(
            file,
            "  {{ cmd = \"{}\", ranges = {{ {} }} }},",
            script.latex_cmd_name(),
            ranges_lua.join(", "),
        )?;
    }
    writeln!(file, "}}")?;

    write!(file, "{LUA_FILTER_LOGIC}")?;

    Ok(file)
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
    let indic_fonts = parsed
        .map
        .get("indic-fonts")
        .and_then(|v| match v {
            serde_yaml::Value::Mapping(m) => {
                let mut map = HashMap::new();
                for (k, v) in m {
                    if let (serde_yaml::Value::String(key), serde_yaml::Value::String(val)) = (k, v) {
                        map.insert(key.clone(), val.clone());
                    }
                }
                Some(map)
            }
            _ => None,
        })
        .unwrap_or_default();

    ExportFrontmatter {
        csl: get_str("csl"),
        template: get_str("template"),
        reference_doc: get_str("reference-doc"),
        cjk_mainfont: get_str("CJKmainfont"),
        indic_font: get_str("indic-font"),
        indic_fonts,
        image_dir: get_str("image_dir").or_else(|| get_str("image-dir")),
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
    // Test escape hatch: when set, skip the hardcoded extra_dirs scan so tests can
    // deterministically force a not-found result. Inert in normal operation.
    if std::env::var("LIT_DISABLE_PATH_EXTRA_DIRS").is_err() {
        for dir in extra_dirs {
            let candidate = Path::new(dir).join(binary_name);
            if candidate.is_file() {
                return Some(candidate);
            }
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
) -> Option<PathBuf> {
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

fn is_valid_docx(path: &Path) -> bool {
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    let mut magic = [0u8; 4];
    matches!(f.read_exact(&mut magic), Ok(())) && magic == [0x50, 0x4B, 0x03, 0x04]
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
                if p.is_file() && is_valid_docx(&p) {
                    return Some(p);
                }
            }
        }
    }
    resource_dir
        .map(|d| d.join("academic").join("lit-reference.docx"))
        .filter(|p| p.is_file())
        .filter(|p| is_valid_docx(p))
}

/// Resolve the bundled LaTeX preamble (extra packages like dsfont, stmaryrd).
/// Only applies to LaTeX output format.
pub fn resolve_preamble(format: &str, resource_dir: Option<&Path>) -> Option<PathBuf> {
    if format == "latex" {
        resource_dir
            .map(|d| d.join("academic/preamble.tex"))
            .filter(|p| p.is_file())
    } else {
        None
    }
}

/// Resolve the bundled Lua filter that escapes bare `&` in Math, RawInline, and RawBlock nodes.
/// Only applies to LaTeX output format.
pub fn resolve_ampersand_filter(format: &str, resource_dir: Option<&Path>) -> Option<PathBuf> {
    if format == "latex" {
        resource_dir
            .map(|d| d.join("academic/escape-ampersand.lua"))
            .filter(|p| p.is_file())
    } else {
        None
    }
}

/// Returns the platform-appropriate package-manager hint for installing pandoc.
fn pandoc_install_hint() -> &'static str {
    if cfg!(target_os = "macos") {
        "macOS: brew install pandoc"
    } else if cfg!(target_os = "windows") {
        "Windows: winget install --id JohnMacFarlane.Pandoc (or choco install pandoc)"
    } else if cfg!(target_os = "linux") {
        "Linux: install via your package manager (e.g. sudo apt install pandoc or sudo dnf install pandoc)"
    } else {
        "Use the download link below"
    }
}

fn pandoc_not_found_error(operation: &str) -> String {
    let hint = pandoc_install_hint();
    format!(
        "pandoc is required for {operation} but was not found on your system.\n\
         \n\
         To install pandoc:\n  \
         - {hint}\n  \
         - Download: https://pandoc.org/installing.html\n\
         \n\
         To use a custom pandoc location, set the path in Settings \u{2192} Academic Export \u{2192} Pandoc Path."
    )
}

fn pandoc_invalid_path_error(path: &str) -> String {
    format!(
        "The configured pandoc path does not exist, is not a file, or is not executable: {path}\n\
         \n\
         This path is set in Settings \u{2192} Academic Export \u{2192} Pandoc Path.\n\
         Either correct the path or clear it to auto-detect pandoc from PATH."
    )
}

/// Validate that a binary is available, returning its path on success.
///
/// Unlike `resolve_binary`, this does NOT silently fall through from an invalid
/// configured path to PATH lookup. If the user explicitly set a path, they get
/// told it's broken. The two error messages are injected so this helper carries
/// no binary-specific wording.
pub fn validate_binary(
    pref_key: &str,
    fallback_name: &str,
    operation: &str,
    prefs: &preferences::Preferences,
    not_found_error: impl Fn(&str) -> String,
    invalid_path_error: impl Fn(&str) -> String,
) -> Result<PathBuf, String> {
    if let Some(val) = prefs.extra.get(pref_key) {
        if let Some(s) = val.as_str() {
            if !s.is_empty() {
                let p = PathBuf::from(s);
                if p.is_file() {
                    // On Unix, a configured path that lacks any execute bit will
                    // fail cryptically at spawn time; reject it up front.
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let executable = std::fs::metadata(&p)
                            .map(|m| m.permissions().mode() & 0o111 != 0)
                            .unwrap_or(false);
                        if !executable {
                            return Err(invalid_path_error(s));
                        }
                    }
                    return Ok(p);
                }
                return Err(invalid_path_error(s));
            }
        }
    }
    find_in_path(fallback_name).ok_or_else(|| not_found_error(operation))
}

/// Validate that pandoc is available, returning its path on success.
///
/// Thin wrapper over [`validate_binary`] supplying the pandoc pref key, PATH
/// fallback name, and pandoc-specific error messages.
pub fn validate_pandoc(
    operation: &str,
    prefs: &preferences::Preferences,
) -> Result<PathBuf, String> {
    validate_binary(
        "academic.pandocPath",
        "pandoc",
        operation,
        prefs,
        pandoc_not_found_error,
        pandoc_invalid_path_error,
    )
}

/// Build the argument list for a pandoc invocation.
pub fn resolve_image_dir(image_dir: &str, note_dir: &Path, workspace_root: &Path) -> PathBuf {
    let trimmed = image_dir.trim_end_matches('/');
    if trimmed.is_empty() {
        return workspace_root.to_path_buf();
    }
    let p = Path::new(trimmed);
    if p.is_absolute() {
        return p.to_path_buf();
    }
    if trimmed.starts_with("./") || trimmed.starts_with("../") {
        return note_dir.join(trimmed);
    }
    workspace_root.join(trimmed)
}

pub fn build_pandoc_args(
    input_path: &Path,
    output_path: &Path,
    format: &str,
    resource_paths: &[PathBuf],
    crossref_path: Option<&Path>,
    reference_doc: Option<&Path>,
    csl: Option<&Path>,
    template: Option<&Path>,
) -> Vec<String> {
    let mut args = Vec::new();

    args.push(input_path.to_string_lossy().to_string());

    args.push("-t".to_string());
    args.push(format.to_string());

    args.push("-o".to_string());
    args.push(output_path.to_string_lossy().to_string());

    // DOCX embeds styles internally; --standalone is not needed (and not supported)
    if format != "docx" {
        args.push("--standalone".to_string());
    }

    args.push("--resource-path".to_string());
    let joined = std::env::join_paths(resource_paths)
        .or_else(|_| {
            let valid: Vec<_> = resource_paths.iter()
                .filter(|p| std::env::join_paths(std::iter::once(p)).is_ok())
                .collect();
            if valid.len() < resource_paths.len() {
                tracing::warn!(
                    "Skipped {} resource path(s) containing invalid characters",
                    resource_paths.len() - valid.len()
                );
            }
            std::env::join_paths(valid)
        })
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    args.push(joined);

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

    if let Some(ref_doc) = reference_doc {
        args.push(format!("--reference-doc={}", ref_doc.to_string_lossy()));
    }

    if let Some(tmpl) = template {
        args.push(format!("--template={}", tmpl.to_string_lossy()));
    }
    if format == "latex" {
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

    let pandoc_path = validate_pandoc("detection", &prefs)?;

    let pandoc_version = get_version(&pandoc_path)?;

    let crossref_path = resolve_binary("academic.crossrefFilterPath", "pandoc-crossref", &prefs);
    let crossref_version = crossref_path
        .as_ref()
        .and_then(|p| get_version(p).ok());

    Ok(PandocInfo {
        pandoc_path: pandoc_path.to_string_lossy().to_string(),
        pandoc_version,
        crossref_path: crossref_path.map(|p| p.to_string_lossy().to_string()),
        crossref_version,
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
        "latex" | "html" | "docx" => {}
        _ => return Err(format!("unsupported format: {format}")),
    }
    let note_dir = input_path.parent().unwrap_or(&workspace_root).to_path_buf();

    let prefs = preferences::read_preferences(&app_handle);
    let pandoc_path = validate_pandoc(&format!("{format} export"), &prefs)?;
    let crossref_path = resolve_binary("academic.crossrefFilterPath", "pandoc-crossref", &prefs);

    // Extract frontmatter overrides from the document
    let frontmatter = extract_export_frontmatter(&input_path);

    let resource_dir = app_handle.path().resource_dir().ok();

    // Resolve reference doc: request -> frontmatter -> preference -> bundled
    let reference_doc = if format == "docx" {
        if let Some(ref rd) = request.reference_doc.as_ref().or(frontmatter.reference_doc.as_ref()) {
            let p = PathBuf::from(rd);
            if p.is_file() && is_valid_docx(&p) { Some(p) } else { resolve_reference_doc(&prefs, resource_dir.as_deref()) }
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
    );

    // Read content once for CJK + Indic detection
    let content = if format == "latex" {
        std::fs::read_to_string(&input_path).unwrap_or_default()
    } else {
        String::new()
    };

    // Resolve CJK font for LaTeX: frontmatter → preference → auto-detect
    let cjk_font = resolve_cjk_font(frontmatter.cjk_mainfont.as_deref(), &prefs, &content);

    // Resolve Indic fonts for LaTeX
    let (indic_preamble_file, indic_lua_filter) = if format == "latex" {
        let detected = detect_indic_scripts(&content);
        if !detected.is_empty() {
            let fonts = resolve_indic_fonts(
                &detected,
                frontmatter.indic_font.as_deref(),
                &frontmatter.indic_fonts,
                &prefs,
            );
            let preamble = match build_indic_preamble(&fonts, None) {
                Ok(f) => Some(f),
                Err(e) => {
                    tracing::warn!("failed to create Indic preamble: {e}");
                    None
                }
            };
            let engine_name = "xelatex";
            let lua_filter = if engine_name.contains("xelatex") || engine_name.contains("lualatex") {
                match build_indic_lua_filter(&fonts) {
                    Ok(f) => Some(f),
                    Err(e) => {
                        tracing::warn!("failed to create Indic Lua filter: {e}");
                        None
                    }
                }
            } else {
                None
            };
            (preamble, lua_filter)
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    // Resolve bundled preamble for LaTeX (extra packages like dsfont)
    let preamble = resolve_preamble(&format, resource_dir.as_deref());

    // Resolve bundled Lua filter for escaping bare & in Math/RawInline nodes
    let ampersand_filter = resolve_ampersand_filter(&format, resource_dir.as_deref());

    let image_dir_str = frontmatter.image_dir
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| prefs.extra.get("editor.defaultImageDir").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()))
        .unwrap_or(DEFAULT_IMAGE_DIR);
    let resolved_image_dir = resolve_image_dir(image_dir_str, &note_dir, &workspace_root);
    let mut resource_paths = vec![note_dir];
    if !resource_paths.contains(&resolved_image_dir) {
        resource_paths.push(resolved_image_dir);
    }

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
            &resource_paths,
            crossref_path.as_deref(),
            reference_doc.as_deref(),
            csl.as_deref(),
            template.as_deref(),
        );

        if let Some(ref font) = cjk_font {
            args.push(format!("--variable=CJKmainfont={font}"));
        }

        if let Some(ref indic_file) = indic_preamble_file {
            args.push(format!("--include-in-header={}", indic_file.path().to_string_lossy()));
        }

        if let Some(ref indic_lua) = indic_lua_filter {
            args.push(format!("--lua-filter={}", indic_lua.path().to_string_lossy()));
        }

        if let Some(ref p) = preamble {
            args.push(format!("--include-in-header={}", p.to_string_lossy()));
        }

        if let Some(ref f) = ampersand_filter {
            args.push(format!("--lua-filter={}", f.to_string_lossy()));
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

        let _ = win.emit("lit:academic-export-progress", AcademicExportProgress {
            stage: "done".to_string(),
            format: fmt_for_event,
        });

        Ok::<ExportResult, String>(ExportResult {
            output_path: request.output_path.clone(),
            success,
            stderr,
        })
    })
    .await
    .map_err(|e| format!("task join error: {e}"))??;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serializes env-mutating tests in this module (PATH, LIT_DISABLE_PATH_EXTRA_DIRS)
    /// since `std::env::set_var`/`remove_var` are process-global.
    static ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn test_build_pandoc_args_basic() {
        let args = build_pandoc_args(
            Path::new("/input.md"),
            Path::new("/output.tex"),
            "latex",
            &[PathBuf::from("/workspace/notes")],
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
            &[PathBuf::from("/notes")],
            Some(Path::new("/usr/local/bin/pandoc-crossref")),
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
    fn test_build_pandoc_args_html_includes_mathjax() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.html"), "html",
            &[PathBuf::from("/notes")], None, None, None, None,
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
            &[PathBuf::from("/notes")], None, None, None, None,
        );
        assert!(args.contains(&"-t".to_string()));
        assert!(args.contains(&"docx".to_string()));
        assert!(!args.contains(&"--standalone".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_docx_with_reference_doc() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.docx"), "docx",
            &[PathBuf::from("/notes")], None, Some(Path::new("/resources/ref.docx")),
            None, None,
        );
        assert!(args.contains(&"--reference-doc=/resources/ref.docx".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_docx_without_reference_doc() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.docx"), "docx",
            &[PathBuf::from("/notes")], None, None, None, None,
        );
        assert!(!args.iter().any(|a| a.starts_with("--reference-doc")));
    }

    #[test]
    fn test_build_pandoc_args_latex_no_mathjax() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.tex"), "latex",
            &[PathBuf::from("/notes")], None, None, None, None,
        );
        assert!(!args.contains(&"--mathjax".to_string()));
    }

    #[test]
    fn test_resolve_reference_doc_from_prefs() {
        let tmp = std::env::temp_dir().join("test_ref_doc.docx");
        let mut content = vec![0x50, 0x4B, 0x03, 0x04];
        content.extend_from_slice(b"fake zip");
        std::fs::write(&tmp, &content).unwrap();
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
            &[PathBuf::from("/notes")], None, None, Some(Path::new("/styles/ieee.csl")), None,
        );
        assert!(args.contains(&"--citeproc".to_string()));
        assert!(args.contains(&"--csl=/styles/ieee.csl".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_with_template() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.tex"), "latex",
            &[PathBuf::from("/notes")], None, None, None, Some(Path::new("/templates/my.tex")),
        );
        assert!(args.contains(&"--template=/templates/my.tex".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_with_csl_and_template() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.tex"), "latex",
            &[PathBuf::from("/notes")], None, None,
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
            &[PathBuf::from("/notes")], None, None, None, None,
        );
        assert!(!args.contains(&"--citeproc".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_crossref_before_citeproc() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.tex"), "latex",
            &[PathBuf::from("/notes")],
            Some(Path::new("/usr/local/bin/pandoc-crossref")),
            None,
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
    fn test_resolve_template_none_without_overrides() {
        let prefs = preferences::Preferences::default();
        let result = resolve_template(None, None, &prefs);
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_template_request_override() {
        let tmp = std::env::temp_dir().join("test_tmpl_override");
        std::fs::create_dir_all(&tmp).unwrap();
        let custom = tmp.join("custom.tex");
        std::fs::write(&custom, "fake").unwrap();
        let prefs = preferences::Preferences::default();
        let result = resolve_template(Some(&custom.to_string_lossy()), None, &prefs);
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
        let result = resolve_template(None, Some(&fm_tmpl.to_string_lossy()), &prefs);
        assert_eq!(result, Some(fm_tmpl));
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn test_extract_export_frontmatter_with_all_fields() {
        let dir = std::env::temp_dir().join("test_fm_all");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "---\ncsl: ieee\ntemplate: /my/t.tex\nreference-doc: /r.docx\nCJKmainfont: Noto Serif CJK SC\n---\nBody\n").unwrap();
        let fm = extract_export_frontmatter(&file);
        assert_eq!(fm.csl.as_deref(), Some("ieee"));
        assert_eq!(fm.template.as_deref(), Some("/my/t.tex"));
        assert_eq!(fm.reference_doc.as_deref(), Some("/r.docx"));
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
    }

    #[test]
    fn test_export_request_deserializes_with_optional_fields() {
        let json = r#"{"relative_path":"a.md","output_path":"/out.tex","format":"latex","csl":"apa","template":"/t.tex","reference_doc":"/r.docx"}"#;
        let req: ExportRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.csl.as_deref(), Some("apa"));
        assert_eq!(req.template.as_deref(), Some("/t.tex"));
        assert_eq!(req.reference_doc.as_deref(), Some("/r.docx"));
    }

    #[test]
    fn test_resolve_reference_doc_falls_back_to_bundled() {
        let tmp_dir = std::env::temp_dir().join("test_resolve_ref_doc_bundled");
        let academic_dir = tmp_dir.join("academic");
        std::fs::create_dir_all(&academic_dir).unwrap();
        let ref_doc = academic_dir.join("lit-reference.docx");
        let mut content = vec![0x50, 0x4B, 0x03, 0x04];
        content.extend_from_slice(b"fake zip");
        std::fs::write(&ref_doc, &content).unwrap();
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
        for fmt in &["latex"] {
            let args = build_pandoc_args(
                Path::new("/input.md"), Path::new("/output"), fmt,
                &[PathBuf::from("/notes")], None, None, None, None,
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
    fn test_build_pandoc_args_custom_template_still_has_variables() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.tex"), "latex",
            &[PathBuf::from("/notes")], None, None, None, Some(Path::new("/t/custom.tex")),
        );
        assert!(args.contains(&"--template=/t/custom.tex".to_string()));
        assert!(args.contains(&"--variable=geometry:margin=1in".to_string()));
    }

    #[test]
    fn test_build_pandoc_args_html_no_variables() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.html"), "html",
            &[PathBuf::from("/notes")], None, None, None, None,
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

    // --- is_valid_docx / reference-doc validation tests ---

    #[test]
    fn test_is_valid_docx_with_placeholder_file() {
        let tmp = std::env::temp_dir().join("test_invalid_docx.docx");
        std::fs::write(&tmp, "placeholder").unwrap();
        assert!(!is_valid_docx(&tmp));
        std::fs::remove_file(&tmp).unwrap();
    }

    #[test]
    fn test_is_valid_docx_with_empty_file() {
        let tmp = std::env::temp_dir().join("test_empty_docx.docx");
        std::fs::write(&tmp, b"").unwrap();
        assert!(!is_valid_docx(&tmp));
        std::fs::remove_file(&tmp).unwrap();
    }

    #[test]
    fn test_is_valid_docx_with_zip_magic() {
        let tmp = std::env::temp_dir().join("test_valid_docx.docx");
        let mut content = vec![0x50, 0x4B, 0x03, 0x04];
        content.extend_from_slice(b"rest of zip data");
        std::fs::write(&tmp, &content).unwrap();
        assert!(is_valid_docx(&tmp));
        std::fs::remove_file(&tmp).unwrap();
    }

    #[test]
    fn test_is_valid_docx_nonexistent() {
        assert!(!is_valid_docx(Path::new("/nonexistent/file.docx")));
    }

    #[test]
    fn test_resolve_reference_doc_rejects_placeholder_bundled() {
        let tmp_dir = std::env::temp_dir().join("test_ref_doc_placeholder");
        let academic_dir = tmp_dir.join("academic");
        std::fs::create_dir_all(&academic_dir).unwrap();
        std::fs::write(academic_dir.join("lit-reference.docx"), "placeholder").unwrap();
        let prefs = preferences::Preferences::default();
        let result = resolve_reference_doc(&prefs, Some(&tmp_dir));
        assert!(result.is_none());
        std::fs::remove_dir_all(&tmp_dir).unwrap();
    }

    #[test]
    fn test_resolve_reference_doc_rejects_placeholder_pref() {
        let tmp = std::env::temp_dir().join("test_ref_doc_pref_placeholder.docx");
        std::fs::write(&tmp, "placeholder").unwrap();
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.defaultReferenceDoc".to_string(),
            serde_json::Value::String(tmp.to_string_lossy().to_string()),
        );
        let result = resolve_reference_doc(&prefs, None);
        assert!(result.is_none());
        std::fs::remove_file(&tmp).unwrap();
    }

    #[test]
    fn test_resolve_reference_doc_accepts_valid_bundled() {
        let tmp_dir = std::env::temp_dir().join("test_ref_doc_valid_bundled");
        let academic_dir = tmp_dir.join("academic");
        std::fs::create_dir_all(&academic_dir).unwrap();
        let mut content = vec![0x50, 0x4B, 0x03, 0x04];
        content.extend_from_slice(b"fake zip");
        std::fs::write(academic_dir.join("lit-reference.docx"), &content).unwrap();
        let prefs = preferences::Preferences::default();
        let result = resolve_reference_doc(&prefs, Some(&tmp_dir));
        assert_eq!(result, Some(academic_dir.join("lit-reference.docx")));
        std::fs::remove_dir_all(&tmp_dir).unwrap();
    }

    // --- validate_pandoc tests ---

    #[test]
    fn test_pandoc_not_found_error_format() {
        let msg = pandoc_not_found_error("PDF export");
        assert!(msg.contains("PDF export"), "should mention the operation");
        if cfg!(target_os = "macos") {
            assert!(msg.contains("brew install pandoc"), "should include brew install hint on macOS");
        } else if cfg!(target_os = "windows") {
            assert!(
                msg.contains("winget") || msg.contains("choco"),
                "should include winget/choco install hint on Windows"
            );
            assert!(
                !msg.contains("brew install pandoc"),
                "should not present brew as the hint off macOS"
            );
        } else if cfg!(target_os = "linux") {
            assert!(
                msg.contains("apt") || msg.contains("dnf"),
                "should include apt/dnf install hint on Linux"
            );
            assert!(
                !msg.contains("brew install pandoc"),
                "should not present brew as the hint off macOS"
            );
        }
        assert!(msg.contains("pandoc.org"), "should include download link");
        assert!(msg.contains("Settings"), "should mention Settings");
    }

    #[test]
    fn test_pandoc_invalid_path_error_format() {
        let msg = pandoc_invalid_path_error("/bad/path");
        assert!(msg.contains("/bad/path"), "should include the configured path");
        assert!(msg.contains("configured pandoc path"), "frontend classifies by this phrase");
        assert!(msg.contains("does not exist"), "should explain the missing-file case");
        assert!(msg.contains("not executable"), "should explain the non-executable case");
        assert!(msg.contains("Settings"), "should mention Settings");
    }

    #[cfg(unix)]
    #[test]
    fn test_validate_binary_err_non_executable() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = std::env::temp_dir().join("test_validate_binary_non_exec");
        std::fs::write(&tmp, "fake").unwrap();
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o644)).unwrap();
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "custom.binPath".to_string(),
            serde_json::Value::String(tmp.to_string_lossy().to_string()),
        );
        let result = validate_binary(
            "custom.binPath",
            "custom-bin",
            "filtering",
            &prefs,
            |op| format!("nf {op}"),
            |p| format!("bad {p}"),
        );
        std::fs::remove_file(&tmp).ok();
        let err = result.expect_err("a non-executable configured path should fail loudly");
        assert_eq!(err, format!("bad {}", tmp.to_string_lossy()));
    }

    #[cfg(unix)]
    #[test]
    fn test_validate_pandoc_err_non_executable() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = std::env::temp_dir().join("test_validate_pandoc_non_exec");
        std::fs::write(&tmp, "fake").unwrap();
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o644)).unwrap();
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.pandocPath".to_string(),
            serde_json::Value::String(tmp.to_string_lossy().to_string()),
        );
        let result = validate_pandoc("export", &prefs);
        std::fs::remove_file(&tmp).ok();
        let err = result.expect_err("a non-executable pandoc path should fail loudly");
        assert!(err.contains(&*tmp.to_string_lossy()), "should include the bad path");
        assert!(err.contains("not executable"), "should explain it is not executable");
    }

    #[test]
    fn test_validate_pandoc_ok_with_valid_pref() {
        let tmp = std::env::temp_dir().join("test_validate_pandoc_ok");
        std::fs::write(&tmp, "fake").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.pandocPath".to_string(),
            serde_json::Value::String(tmp.to_string_lossy().to_string()),
        );
        let result = validate_pandoc("export", &prefs);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), tmp);
        std::fs::remove_file(&tmp).unwrap();
    }

    #[test]
    fn test_validate_pandoc_err_invalid_pref() {
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.pandocPath".to_string(),
            serde_json::Value::String("/nonexistent/path/to/pandoc".to_string()),
        );
        let result = validate_pandoc("export", &prefs);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("/nonexistent/path/to/pandoc"), "should include the bad path");
        assert!(err.contains("does not exist"), "should explain the problem");
    }

    #[test]
    fn test_validate_pandoc_err_not_found() {
        let _lock = ENV_MUTEX.lock().unwrap();
        // Deterministically force the not-found branch: point PATH at an empty temp
        // dir and disable the hardcoded macOS extra_dirs scan. This guarantees the
        // error-message assertions always run, even when pandoc is installed.
        let empty_dir = std::env::temp_dir().join("test_validate_pandoc_empty_path");
        std::fs::create_dir_all(&empty_dir).unwrap();
        let saved_path = std::env::var("PATH").ok();
        std::env::set_var("PATH", &empty_dir);
        std::env::set_var("LIT_DISABLE_PATH_EXTRA_DIRS", "1");

        let result = validate_pandoc("PDF export", &preferences::Preferences::default());

        // Restore env BEFORE asserting so a failed assert can't leak env state.
        match saved_path {
            Some(p) => std::env::set_var("PATH", p),
            None => std::env::remove_var("PATH"),
        }
        std::env::remove_var("LIT_DISABLE_PATH_EXTRA_DIRS");
        std::fs::remove_dir_all(&empty_dir).ok();

        let err = result.expect_err("pandoc should be reported as not found");
        assert!(err.contains("PDF export"), "should mention the operation");
        assert!(err.contains("pandoc.org"), "should include install instructions");
        assert!(err.contains("Settings"), "should mention Settings");
    }

    #[test]
    fn test_validate_pandoc_empty_pref_not_invalid() {
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.pandocPath".to_string(),
            serde_json::Value::String("".to_string()),
        );
        let result = validate_pandoc("export", &prefs);
        // Empty pref should NOT produce the "configured path" error
        if let Err(err) = result {
            assert!(!err.contains("configured pandoc path"), "empty pref should fall through to PATH lookup, not report as invalid path");
        }
    }

    // --- validate_binary tests (parameterized helper) ---

    #[test]
    fn test_validate_binary_ok_with_valid_pref() {
        let tmp = std::env::temp_dir().join("test_validate_binary_ok");
        std::fs::write(&tmp, "fake").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "custom.binPath".to_string(),
            serde_json::Value::String(tmp.to_string_lossy().to_string()),
        );
        let result = validate_binary(
            "custom.binPath",
            "custom-bin",
            "filtering",
            &prefs,
            |op| format!("nf {op}"),
            |p| format!("bad {p}"),
        );
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), tmp);
        std::fs::remove_file(&tmp).unwrap();
    }

    #[test]
    fn test_validate_binary_err_invalid_pref() {
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "custom.binPath".to_string(),
            serde_json::Value::String("/nonexistent/path/to/bin".to_string()),
        );
        let result = validate_binary(
            "custom.binPath",
            "custom-bin",
            "filtering",
            &prefs,
            |op| format!("nf {op}"),
            |p| format!("bad {p}"),
        );
        let err = result.expect_err("invalid configured path should fail loudly");
        assert_eq!(err, "bad /nonexistent/path/to/bin");
    }

    #[test]
    fn test_validate_binary_err_not_found() {
        let _lock = ENV_MUTEX.lock().unwrap();
        let empty_dir = std::env::temp_dir().join("test_validate_binary_empty_path");
        std::fs::create_dir_all(&empty_dir).unwrap();
        let saved_path = std::env::var("PATH").ok();
        std::env::set_var("PATH", &empty_dir);
        std::env::set_var("LIT_DISABLE_PATH_EXTRA_DIRS", "1");

        let result = validate_binary(
            "custom.binPath",
            "definitely-not-a-real-binary-xyz",
            "filtering",
            &preferences::Preferences::default(),
            |op| format!("nf {op}"),
            |p| format!("bad {p}"),
        );

        // Restore env BEFORE asserting so a failed assert can't leak env state.
        match saved_path {
            Some(p) => std::env::set_var("PATH", p),
            None => std::env::remove_var("PATH"),
        }
        std::env::remove_var("LIT_DISABLE_PATH_EXTRA_DIRS");
        std::fs::remove_dir_all(&empty_dir).ok();

        let err = result.expect_err("binary should be reported as not found");
        assert_eq!(err, "nf filtering");
    }

    #[test]
    fn test_validate_binary_empty_pref_falls_through() {
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "custom.binPath".to_string(),
            serde_json::Value::String("".to_string()),
        );
        let result = validate_binary(
            "custom.binPath",
            "custom-bin",
            "filtering",
            &prefs,
            |op| format!("nf {op}"),
            |p| format!("bad {p}"),
        );
        // Empty pref must NOT take the invalid-path branch.
        if let Err(err) = result {
            assert_ne!(err, "bad ", "empty pref should fall through to PATH lookup");
            assert!(!err.starts_with("bad"), "empty pref should not report invalid path");
        }
    }

    #[test]
    fn test_preamble_resolved_from_resource_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let preamble_dir = tmp.path().join("academic");
        std::fs::create_dir_all(&preamble_dir).unwrap();
        let preamble_path = preamble_dir.join("preamble.tex");
        std::fs::write(&preamble_path, "% test preamble\n").unwrap();

        let result_latex = resolve_preamble("latex", Some(tmp.path()));
        assert_eq!(result_latex, Some(preamble_path));
    }

    #[test]
    fn test_preamble_not_resolved_when_missing() {
        let tmp = tempfile::tempdir().unwrap();

        let result = resolve_preamble("latex", Some(tmp.path()));
        assert_eq!(result, None);

        let result_none = resolve_preamble("latex", None);
        assert_eq!(result_none, None);
    }

    #[test]
    fn test_preamble_not_resolved_for_html() {
        let tmp = tempfile::tempdir().unwrap();
        let preamble_dir = tmp.path().join("academic");
        std::fs::create_dir_all(&preamble_dir).unwrap();
        std::fs::write(preamble_dir.join("preamble.tex"), "% test\n").unwrap();

        let result = resolve_preamble("html", Some(tmp.path()));
        assert_eq!(result, None);
    }

    #[test]
    fn test_preamble_not_resolved_for_docx() {
        let tmp = tempfile::tempdir().unwrap();
        let preamble_dir = tmp.path().join("academic");
        std::fs::create_dir_all(&preamble_dir).unwrap();
        std::fs::write(preamble_dir.join("preamble.tex"), "% test\n").unwrap();

        let result = resolve_preamble("docx", Some(tmp.path()));
        assert_eq!(result, None);
    }

    // --- resolve_ampersand_filter tests ---

    #[test]
    fn test_ampersand_filter_not_resolved_for_html() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("academic");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("escape-ampersand.lua"), "-- stub\n").unwrap();

        assert_eq!(resolve_ampersand_filter("html", Some(tmp.path())), None);
    }

    #[test]
    fn test_ampersand_filter_not_resolved_for_docx() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("academic");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("escape-ampersand.lua"), "-- stub\n").unwrap();

        assert_eq!(resolve_ampersand_filter("docx", Some(tmp.path())), None);
    }

    #[test]
    fn test_ampersand_filter_not_resolved_when_missing() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(resolve_ampersand_filter("latex", Some(tmp.path())), None);
    }

    #[test]
    fn test_ampersand_filter_not_resolved_without_resource_dir() {
        assert_eq!(resolve_ampersand_filter("latex", None), None);
    }

    #[test]
    fn test_ampersand_filter_resolved_for_latex() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("academic");
        std::fs::create_dir_all(&dir).unwrap();
        let lua_path = dir.join("escape-ampersand.lua");
        std::fs::write(&lua_path, "-- filter\n").unwrap();

        assert_eq!(resolve_ampersand_filter("latex", Some(tmp.path())), Some(lua_path));
    }

    // --- Indic script detection tests ---

    #[test]
    fn test_detect_indic_scripts_empty() {
        assert!(detect_indic_scripts("").is_empty());
    }

    #[test]
    fn test_detect_indic_scripts_ascii_only() {
        assert!(detect_indic_scripts("Hello, world! Plain English.").is_empty());
    }

    #[test]
    fn test_detect_indic_scripts_devanagari() {
        let detected = detect_indic_scripts("नमस्ते");
        assert_eq!(detected.len(), 1);
        assert!(detected.contains(&IndicScript::Devanagari));
    }

    #[test]
    fn test_detect_indic_scripts_thai() {
        let detected = detect_indic_scripts("สวัสดี");
        assert_eq!(detected.len(), 1);
        assert!(detected.contains(&IndicScript::Thai));
    }

    #[test]
    fn test_detect_indic_scripts_multiple() {
        let detected = detect_indic_scripts("नमस्ते தமிழ் สวัสดี");
        assert!(detected.contains(&IndicScript::Devanagari));
        assert!(detected.contains(&IndicScript::Tamil));
        assert!(detected.contains(&IndicScript::Thai));
    }

    #[test]
    fn test_detect_indic_scripts_sharada() {
        let detected = detect_indic_scripts("\u{11180}\u{11181}");
        assert_eq!(detected.len(), 1);
        assert!(detected.contains(&IndicScript::Sharada));
    }

    #[test]
    fn test_detect_indic_scripts_cjk_not_included() {
        let detected = detect_indic_scripts("这是中文 これはテスト 한국어");
        assert!(detected.is_empty());
    }

    // --- Indic font resolution tests ---

    #[test]
    fn test_resolve_indic_fonts_defaults() {
        let mut detected = HashSet::new();
        detected.insert(IndicScript::Devanagari);
        detected.insert(IndicScript::Thai);
        let prefs = preferences::Preferences::default();
        let fonts = resolve_indic_fonts(&detected, None, &HashMap::new(), &prefs);
        assert_eq!(fonts[&IndicScript::Devanagari], IndicScript::Devanagari.default_font());
        assert_eq!(fonts[&IndicScript::Thai], IndicScript::Thai.default_font());
    }

    #[test]
    fn test_resolve_indic_fonts_catchall_pref() {
        let mut detected = HashSet::new();
        detected.insert(IndicScript::Devanagari);
        detected.insert(IndicScript::Thai);
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.indicFont".to_string(),
            serde_json::Value::String("MyIndicFont".to_string()),
        );
        let fonts = resolve_indic_fonts(&detected, None, &HashMap::new(), &prefs);
        assert_eq!(fonts[&IndicScript::Devanagari], "MyIndicFont");
        assert_eq!(fonts[&IndicScript::Thai], "MyIndicFont");
    }

    #[test]
    fn test_resolve_indic_fonts_per_script_pref() {
        let mut detected = HashSet::new();
        detected.insert(IndicScript::Thai);
        detected.insert(IndicScript::Devanagari);
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.indicFont".to_string(),
            serde_json::Value::String("CatchAll".to_string()),
        );
        prefs.extra.insert(
            "academic.indicFont.thai".to_string(),
            serde_json::Value::String("SpecialThai".to_string()),
        );
        let fonts = resolve_indic_fonts(&detected, None, &HashMap::new(), &prefs);
        assert_eq!(fonts[&IndicScript::Thai], "SpecialThai");
        assert_eq!(fonts[&IndicScript::Devanagari], "CatchAll");
    }

    #[test]
    fn test_resolve_indic_fonts_frontmatter_override() {
        let mut detected = HashSet::new();
        detected.insert(IndicScript::Devanagari);
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.indicFont".to_string(),
            serde_json::Value::String("PrefFont".to_string()),
        );
        let mut fm_fonts = HashMap::new();
        fm_fonts.insert("devanagari".to_string(), "FrontmatterFont".to_string());
        let fonts = resolve_indic_fonts(&detected, None, &fm_fonts, &prefs);
        assert_eq!(fonts[&IndicScript::Devanagari], "FrontmatterFont");
    }

    #[test]
    fn test_resolve_indic_fonts_frontmatter_catchall() {
        let mut detected = HashSet::new();
        detected.insert(IndicScript::Bengali);
        let prefs = preferences::Preferences::default();
        let fonts = resolve_indic_fonts(&detected, Some("CatchAllFM"), &HashMap::new(), &prefs);
        assert_eq!(fonts[&IndicScript::Bengali], "CatchAllFM");
    }

    #[test]
    fn test_resolve_indic_fonts_empty_pref_ignored() {
        let mut detected = HashSet::new();
        detected.insert(IndicScript::Thai);
        let mut prefs = preferences::Preferences::default();
        prefs.extra.insert(
            "academic.indicFont".to_string(),
            serde_json::Value::String("".to_string()),
        );
        let fonts = resolve_indic_fonts(&detected, None, &HashMap::new(), &prefs);
        assert_eq!(fonts[&IndicScript::Thai], IndicScript::Thai.default_font());
    }

    // --- Indic preamble tests ---

    #[test]
    fn test_xelatex_preamble_contains_fontspec() {
        let mut fonts = HashMap::new();
        fonts.insert(IndicScript::Devanagari, "TestFont".to_string());
        let file = build_indic_preamble(&fonts, Some(Path::new("xelatex"))).unwrap();
        let content = std::fs::read_to_string(file.path()).unwrap();
        assert!(content.contains("\\usepackage{fontspec}"));
    }

    #[test]
    fn test_xelatex_preamble_contains_newfontfamily() {
        let mut fonts = HashMap::new();
        fonts.insert(IndicScript::Thai, "Thonburi".to_string());
        let file = build_indic_preamble(&fonts, Some(Path::new("xelatex"))).unwrap();
        let content = std::fs::read_to_string(file.path()).unwrap();
        assert!(content.contains("\\newfontfamily\\thaifont[Script=Thai,Renderer=HarfBuzz]{Thonburi}"));
    }

    #[test]
    fn test_xelatex_preamble_no_ucharclasses() {
        let mut fonts = HashMap::new();
        fonts.insert(IndicScript::Devanagari, "TestFont".to_string());
        let file = build_indic_preamble(&fonts, Some(Path::new("xelatex"))).unwrap();
        let content = std::fs::read_to_string(file.path()).unwrap();
        assert!(content.contains("\\newfontfamily\\devanagarifont"));
        assert!(!content.contains("ucharclasses"));
        assert!(!content.contains("\\setTransitionsFor"));
    }

    #[test]
    fn test_lualatex_preamble_no_ucharclasses() {
        let mut fonts = HashMap::new();
        fonts.insert(IndicScript::Devanagari, "TestFont".to_string());
        let file = build_indic_preamble(&fonts, Some(Path::new("lualatex"))).unwrap();
        let content = std::fs::read_to_string(file.path()).unwrap();
        assert!(content.contains("\\newfontfamily\\devanagarifont"));
        assert!(!content.contains("\\usepackage{ucharclasses}"));
        assert!(!content.contains("\\setTransitionsFor"));
        assert!(!content.contains("Renderer=HarfBuzz"));
    }

    #[test]
    fn test_pdflatex_preamble_skips() {
        let mut fonts = HashMap::new();
        fonts.insert(IndicScript::Devanagari, "TestFont".to_string());
        let file = build_indic_preamble(&fonts, Some(Path::new("pdflatex"))).unwrap();
        let content = std::fs::read_to_string(file.path()).unwrap();
        assert!(content.contains("skipped for pdflatex"));
        assert!(!content.contains("\\usepackage{fontspec}"));
    }

    // --- Frontmatter Indic fields tests ---

    #[test]
    fn test_extract_frontmatter_indic_font() {
        let dir = std::env::temp_dir().join("test_fm_indic_font");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "---\nindic-font: \"Noto Sans Devanagari\"\n---\nBody\n").unwrap();
        let fm = extract_export_frontmatter(&file);
        assert_eq!(fm.indic_font.as_deref(), Some("Noto Sans Devanagari"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_extract_frontmatter_indic_fonts_map() {
        let dir = std::env::temp_dir().join("test_fm_indic_fonts_map");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "---\nindic-fonts:\n  devanagari: \"Font A\"\n  thai: \"Font B\"\n---\nBody\n").unwrap();
        let fm = extract_export_frontmatter(&file);
        assert_eq!(fm.indic_fonts.get("devanagari").unwrap(), "Font A");
        assert_eq!(fm.indic_fonts.get("thai").unwrap(), "Font B");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_extract_frontmatter_no_indic_fields() {
        let dir = std::env::temp_dir().join("test_fm_no_indic");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "---\ntitle: Test\n---\nBody\n").unwrap();
        let fm = extract_export_frontmatter(&file);
        assert!(fm.indic_font.is_none());
        assert!(fm.indic_fonts.is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    // --- Lua filter tests ---

    #[test]
    fn test_build_indic_lua_filter_basic() {
        let mut fonts = HashMap::new();
        fonts.insert(IndicScript::Devanagari, "TestFont".to_string());
        let file = build_indic_lua_filter(&fonts).unwrap();
        let content = std::fs::read_to_string(file.path()).unwrap();
        assert!(content.contains("FORMAT:match 'latex'"));
        assert!(content.contains("devanagarifont"));
        assert!(content.contains("0x0900"));
        assert!(content.contains("0x097F"));
        assert!(content.contains("function Str(el)"));
    }

    #[test]
    fn test_build_indic_lua_filter_multiple_scripts() {
        let mut fonts = HashMap::new();
        fonts.insert(IndicScript::Devanagari, "FontA".to_string());
        fonts.insert(IndicScript::Thai, "FontB".to_string());
        let file = build_indic_lua_filter(&fonts).unwrap();
        let content = std::fs::read_to_string(file.path()).unwrap();
        assert!(content.contains("devanagarifont"));
        assert!(content.contains("thaifont"));
    }

    #[test]
    fn test_build_indic_lua_filter_sorted_deterministic() {
        let mut fonts = HashMap::new();
        fonts.insert(IndicScript::Thai, "FontB".to_string());
        fonts.insert(IndicScript::Bengali, "FontA".to_string());
        fonts.insert(IndicScript::Devanagari, "FontC".to_string());
        let file = build_indic_lua_filter(&fonts).unwrap();
        let content = std::fs::read_to_string(file.path()).unwrap();
        let pos_bengali = content.find("bengalifont").unwrap();
        let pos_devanagari = content.find("devanagarifont").unwrap();
        let pos_thai = content.find("thaifont").unwrap();
        assert!(pos_bengali < pos_devanagari, "bengali should come before devanagari");
        assert!(pos_devanagari < pos_thai, "devanagari should come before thai");
    }

    #[test]
    fn test_build_indic_lua_filter_latex_escape() {
        let mut fonts = HashMap::new();
        fonts.insert(IndicScript::Devanagari, "TestFont".to_string());
        let file = build_indic_lua_filter(&fonts).unwrap();
        let content = std::fs::read_to_string(file.path()).unwrap();
        assert!(content.contains("latex_escape"));
        assert!(content.contains("textbackslash"));
    }

    // --- unicode_ranges tests ---

    #[test]
    fn test_unicode_ranges_devanagari() {
        let ranges = IndicScript::Devanagari.unicode_ranges();
        assert_eq!(ranges.len(), 3);
        assert_eq!(ranges[0], (0x0900, 0x097F));
        assert_eq!(ranges[1], (0xA8E0, 0xA8FF));
        assert_eq!(ranges[2], (0x11B00, 0x11B5F));
    }

    #[test]
    fn test_unicode_ranges_single_range() {
        let ranges = IndicScript::Bengali.unicode_ranges();
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0], (0x0980, 0x09FF));
    }

    #[test]
    fn test_detect_indic_scripts_matches_unicode_ranges() {
        for &script in &ALL_INDIC_SCRIPTS {
            for &(lo, _hi) in script.unicode_ranges() {
                if let Some(c) = char::from_u32(lo) {
                    let text = String::from(c);
                    let detected = detect_indic_scripts(&text);
                    assert!(
                        detected.contains(&script),
                        "detect_indic_scripts should find {:?} for U+{:04X}",
                        script,
                        lo,
                    );
                }
            }
        }
    }

    // --- image_dir / resolve_image_dir tests ---

    #[test]
    fn test_extract_export_frontmatter_image_dir() {
        let dir = std::env::temp_dir().join("test_fm_imgdir");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "---\nimage_dir: media/pics\n---\nBody\n").unwrap();
        let fm = extract_export_frontmatter(&file);
        assert_eq!(fm.image_dir.as_deref(), Some("media/pics"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_extract_export_frontmatter_image_dir_kebab() {
        let dir = std::env::temp_dir().join("test_fm_imgdir_kebab");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "---\nimage-dir: attachments\n---\nBody\n").unwrap();
        let fm = extract_export_frontmatter(&file);
        assert_eq!(fm.image_dir.as_deref(), Some("attachments"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_extract_export_frontmatter_image_dir_underscore_preferred() {
        let dir = std::env::temp_dir().join("test_fm_imgdir_both");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "---\nimage_dir: winner\nimage-dir: loser\n---\nBody\n").unwrap();
        let fm = extract_export_frontmatter(&file);
        assert_eq!(fm.image_dir.as_deref(), Some("winner"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_extract_export_frontmatter_image_dir_empty_falls_through() {
        let dir = std::env::temp_dir().join("test_fm_imgdir_empty");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "---\nimage_dir: \"\"\n---\nBody\n").unwrap();
        let fm = extract_export_frontmatter(&file);
        // Empty string should be stored as Some("") by the parser,
        // but the export path must filter it out (tested separately).
        assert_eq!(fm.image_dir.as_deref(), Some(""));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_resolve_image_dir_absolute() {
        assert_eq!(
            resolve_image_dir("/abs/images", Path::new("/note/dir"), Path::new("/ws")),
            PathBuf::from("/abs/images"),
        );
    }

    #[test]
    fn test_resolve_image_dir_dot_relative() {
        assert_eq!(
            resolve_image_dir("./imgs", Path::new("/ws/notes"), Path::new("/ws")),
            PathBuf::from("/ws/notes/./imgs"),
        );
    }

    #[test]
    fn test_resolve_image_dir_dotdot_relative() {
        assert_eq!(
            resolve_image_dir("../imgs", Path::new("/ws/sub/notes"), Path::new("/ws")),
            PathBuf::from("/ws/sub/notes/../imgs"),
        );
    }

    #[test]
    fn test_resolve_image_dir_bare() {
        assert_eq!(
            resolve_image_dir("assets/images", Path::new("/ws/notes"), Path::new("/ws")),
            PathBuf::from("/ws/assets/images"),
        );
    }

    #[test]
    fn test_resolve_image_dir_empty() {
        assert_eq!(
            resolve_image_dir("", Path::new("/ws/notes"), Path::new("/ws")),
            PathBuf::from("/ws"),
        );
    }

    #[test]
    fn test_build_pandoc_args_multiple_resource_paths() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.docx"), "docx",
            &[PathBuf::from("/ws/notes"), PathBuf::from("/ws/assets/images")],
            None, None, None, None,
        );
        let rp_idx = args.iter().position(|a| a == "--resource-path").unwrap();
        let rp_val = &args[rp_idx + 1];
        assert!(rp_val.contains("/ws/notes"), "resource-path should contain note dir");
        assert!(rp_val.contains("/ws/assets/images"), "resource-path should contain image dir");
    }

    #[cfg(unix)]
    #[test]
    fn test_build_pandoc_args_colon_in_path_keeps_valid_paths() {
        let args = build_pandoc_args(
            Path::new("/input.md"), Path::new("/output.docx"), "docx",
            &[PathBuf::from("/ws/notes"), PathBuf::from("/ws/file:with:colons")],
            None, None, None, None,
        );
        let rp_idx = args.iter().position(|a| a == "--resource-path").unwrap();
        let rp_val = &args[rp_idx + 1];
        assert!(rp_val.contains("/ws/notes"), "valid note dir must survive when a sibling path contains colons");
        assert!(!rp_val.is_empty(), "resource-path must not be empty");
    }
}
