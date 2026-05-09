use regex::Regex;
use serde::Serialize;
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;

fn strip_code(content: &str) -> String {
    let fenced = Regex::new(r"(?ms)^```.*?^```").unwrap();
    let stripped = fenced.replace_all(content, "");
    let inline = Regex::new(r"`[^`]+`").unwrap();
    inline.replace_all(&stripped, "").to_string()
}

pub fn extract_asset_references(content: &str) -> Vec<String> {
    let cleaned = strip_code(content);

    let md_re = Regex::new(r"!\[.*?\]\((.+?)\)").unwrap();
    let obs_re = Regex::new(r"!\[\[(.+?)\]\]").unwrap();

    let mut refs: Vec<String> = md_re
        .captures_iter(&cleaned)
        .map(|c| c[1].to_string())
        .filter(|p| !p.starts_with("http://") && !p.starts_with("https://"))
        .collect();

    refs.extend(obs_re.captures_iter(&cleaned).map(|c| c[1].to_string()));

    let mut seen = HashSet::new();
    refs.retain(|r| seen.insert(r.clone()));
    refs
}

#[derive(Debug, Clone)]
pub struct ExportEntry {
    pub relative_path: String,
    pub absolute_path: PathBuf,
}

fn is_hidden(entry: &walkdir::DirEntry) -> bool {
    if entry.depth() == 0 {
        return false;
    }
    entry
        .file_name()
        .to_str()
        .map(|s| s.starts_with('.'))
        .unwrap_or(false)
}

pub fn collect_export_files(root: &Path) -> Result<Vec<ExportEntry>, String> {
    let mut entries = Vec::new();
    let mut md_files = Vec::new();

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !is_hidden(e))
    {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let is_md = path.extension().and_then(|e| e.to_str()) == Some("md");
        let is_pdf = path.extension().and_then(|e| e.to_str()) == Some("pdf");
        if !is_md && !is_pdf {
            continue;
        }
        let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
        entries.push(ExportEntry {
            relative_path: relative.to_string_lossy().to_string(),
            absolute_path: path.to_path_buf(),
        });
        if is_md {
            md_files.push(path.to_path_buf());
        }
    }

    for md_path in &md_files {
        let content = std::fs::read_to_string(md_path).unwrap_or_default();
        let refs = extract_asset_references(&content);
        let md_dir = md_path.parent().unwrap_or(root);
        for asset_ref in refs {
            let asset_path = md_dir.join(&asset_ref);
            if asset_path.exists() {
                let relative = asset_path
                    .strip_prefix(root)
                    .map_err(|e| e.to_string())?;
                entries.push(ExportEntry {
                    relative_path: relative.to_string_lossy().to_string(),
                    absolute_path: asset_path,
                });
            }
        }
    }

    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    entries.dedup_by(|a, b| a.relative_path == b.relative_path);
    Ok(entries)
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportSummary {
    pub exported_count: usize,
    pub destination: String,
}

pub fn write_zip<F>(entries: &[ExportEntry], dest: &Path, on_progress: F) -> Result<ExportSummary, String>
where
    F: Fn(usize, usize),
{
    let file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let total = entries.len();

    for (i, entry) in entries.iter().enumerate() {
        zip.start_file(&entry.relative_path, options)
            .map_err(|e| e.to_string())?;
        let data = std::fs::read(&entry.absolute_path).map_err(|e| e.to_string())?;
        zip.write_all(&data).map_err(|e| e.to_string())?;
        on_progress(i + 1, total);
    }

    zip.finish().map_err(|e| e.to_string())?;

    Ok(ExportSummary {
        exported_count: total,
        destination: dest.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_standard_markdown_image() {
        let refs = extract_asset_references("![photo](images/photo.png)");
        assert_eq!(refs, vec!["images/photo.png"]);
    }

    #[test]
    fn extract_obsidian_embed() {
        let refs = extract_asset_references("![[diagram.svg]]");
        assert_eq!(refs, vec!["diagram.svg"]);
    }

    #[test]
    fn skip_urls() {
        let refs = extract_asset_references("![x](https://example.com/img.png)");
        assert!(refs.is_empty());
    }

    #[test]
    fn skip_fenced_code_blocks() {
        let input = "before\n```\n![img](path.png)\n```\nafter";
        let refs = extract_asset_references(input);
        assert!(refs.is_empty());
    }

    #[test]
    fn skip_inline_code() {
        let refs = extract_asset_references("use `![img](path.png)` syntax");
        assert!(refs.is_empty());
    }

    #[test]
    fn deduplicate_references() {
        let input = "![a](img.png)\n![b](img.png)";
        let refs = extract_asset_references(input);
        assert_eq!(refs, vec!["img.png"]);
    }

    // --- collect_export_files tests ---

    #[test]
    fn deduplicate_entries() {
        let dir = tempfile::tempdir().unwrap();
        let imgs = dir.path().join("imgs");
        std::fs::create_dir(&imgs).unwrap();
        std::fs::write(imgs.join("shared.png"), b"png").unwrap();
        std::fs::write(dir.path().join("a.md"), "![](imgs/shared.png)").unwrap();
        std::fs::write(dir.path().join("b.md"), "![](imgs/shared.png)").unwrap();

        let entries = collect_export_files(dir.path()).unwrap();
        let count = entries
            .iter()
            .filter(|e| e.relative_path == "imgs/shared.png")
            .count();
        assert_eq!(count, 1);
    }

    #[test]
    fn exclude_hidden_directories() {
        let dir = tempfile::tempdir().unwrap();
        let hidden = dir.path().join(".hidden");
        std::fs::create_dir(&hidden).unwrap();
        std::fs::write(hidden.join("secret.md"), "secret").unwrap();
        std::fs::write(dir.path().join("visible.md"), "hello").unwrap();

        let entries = collect_export_files(dir.path()).unwrap();
        let paths: Vec<&str> = entries.iter().map(|e| e.relative_path.as_str()).collect();
        assert_eq!(paths, vec!["visible.md"]);
    }

    #[test]
    fn skip_missing_assets() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("note.md"), "![](missing.png)").unwrap();

        let entries = collect_export_files(dir.path()).unwrap();
        let paths: Vec<&str> = entries.iter().map(|e| e.relative_path.as_str()).collect();
        assert_eq!(paths, vec!["note.md"]);
    }

    #[test]
    fn collect_referenced_assets() {
        let dir = tempfile::tempdir().unwrap();
        let imgs = dir.path().join("imgs");
        std::fs::create_dir(&imgs).unwrap();
        std::fs::write(dir.path().join("note.md"), "![](imgs/photo.png)").unwrap();
        std::fs::write(imgs.join("photo.png"), b"fake png").unwrap();

        let entries = collect_export_files(dir.path()).unwrap();
        let paths: Vec<&str> = entries.iter().map(|e| e.relative_path.as_str()).collect();
        assert!(paths.contains(&"imgs/photo.png"));
        assert!(paths.contains(&"note.md"));
    }

    #[test]
    fn collect_pdf_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("note.md"), "hello").unwrap();
        std::fs::write(dir.path().join("paper.pdf"), b"fake pdf").unwrap();

        let entries = collect_export_files(dir.path()).unwrap();
        let mut paths: Vec<&str> = entries.iter().map(|e| e.relative_path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, vec!["note.md", "paper.pdf"]);
    }

    #[test]
    fn collect_markdown_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("note.md"), "hello").unwrap();
        std::fs::write(dir.path().join("other.md"), "world").unwrap();

        let entries = collect_export_files(dir.path()).unwrap();
        let mut paths: Vec<&str> = entries.iter().map(|e| e.relative_path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, vec!["note.md", "other.md"]);
    }

    // --- write_zip tests ---

    #[test]
    fn write_zip_creates_valid_archive() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "hello").unwrap();
        std::fs::write(dir.path().join("b.md"), "world").unwrap();

        let entries = collect_export_files(dir.path()).unwrap();
        let dest = dir.path().join("out.zip");

        write_zip(&entries, &dest, |_, _| {}).unwrap();

        let file = std::fs::File::open(&dest).unwrap();
        let archive = zip::ZipArchive::new(file).unwrap();
        let mut names: Vec<String> = (0..archive.len())
            .map(|i| archive.name_for_index(i).unwrap().to_string())
            .collect();
        names.sort();
        assert_eq!(names, vec!["a.md", "b.md"]);
    }

    #[test]
    fn write_zip_preserves_directory_structure() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("subdir");
        std::fs::create_dir(&sub).unwrap();
        std::fs::write(sub.join("note.md"), "nested").unwrap();

        let entries = collect_export_files(dir.path()).unwrap();
        let dest = dir.path().join("out.zip");
        write_zip(&entries, &dest, |_, _| {}).unwrap();

        let file = std::fs::File::open(&dest).unwrap();
        let archive = zip::ZipArchive::new(file).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.name_for_index(i).unwrap().to_string())
            .collect();
        assert_eq!(names, vec!["subdir/note.md"]);
    }

    #[test]
    fn write_zip_progress_callback() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "1").unwrap();
        std::fs::write(dir.path().join("b.md"), "2").unwrap();
        std::fs::write(dir.path().join("c.md"), "3").unwrap();

        let entries = collect_export_files(dir.path()).unwrap();
        let dest = dir.path().join("out.zip");

        let calls = std::sync::Mutex::new(Vec::new());
        write_zip(&entries, &dest, |current, total| {
            calls.lock().unwrap().push((current, total));
        })
        .unwrap();

        let calls = calls.into_inner().unwrap();
        assert_eq!(calls, vec![(1, 3), (2, 3), (3, 3)]);
    }

    #[test]
    fn write_zip_returns_summary() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "1").unwrap();
        std::fs::write(dir.path().join("b.md"), "2").unwrap();

        let entries = collect_export_files(dir.path()).unwrap();
        let dest = dir.path().join("export.zip");
        let summary = write_zip(&entries, &dest, |_, _| {}).unwrap();

        assert_eq!(summary.exported_count, 2);
        assert_eq!(summary.destination, dest.to_string_lossy());
    }
}
