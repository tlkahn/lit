use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::bib::cache::BibCache;
use crate::bib::types::BibEntry;
use crate::util::is_hidden;

/// Walk `root`, parse every `.bib` file (skipping hidden directories), and
/// return all entries with `bib_file` set to the file's absolute path.
///
/// Results are sorted by `bib_file` then `line_number` for determinism. The
/// frontend may re-sort (e.g. by author) downstream.
pub fn scan_workspace_bibs(root: &Path, cache: &BibCache) -> Vec<BibEntry> {
    let mut all = Vec::new();

    for entry in walkdir::WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !is_hidden(e))
    {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("bib") {
            continue;
        }

        // Reuse the metadata walkdir already cached during traversal (no second
        // stat syscall) instead of issuing a fresh `fs::metadata(path)`.
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

        let path_buf = path.to_path_buf();
        // Read the file ONLY on a cache miss: the closure is invoked lazily and
        // is skipped entirely on a warm-cache hit (mtime match).
        let mut entries =
            cache.get_or_parse_with(&path_buf, mtime, || fs::read_to_string(path).ok());
        let path_str = path.to_string_lossy().to_string();
        for e in &mut entries {
            e.bib_file = Some(path_str.clone());
        }
        all.extend(entries);
    }

    all.sort_by(|a, b| {
        a.bib_file
            .cmp(&b.bib_file)
            .then(a.line_number.cmp(&b.line_number))
    });
    all
}

/// Build a key -> BibEntry index from all `.bib` files in the workspace.
/// Used by the graph indexer to create shadow nodes for cited bib keys.
pub fn build_bib_index(root: &Path, cache: &BibCache) -> HashMap<String, BibEntry> {
    scan_workspace_bibs(root, cache)
        .into_iter()
        .map(|e| (e.key.clone(), e))
        .collect()
}

pub fn scan_workspace_bib_paths(root: &Path) -> Vec<String> {
    let mut paths = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !is_hidden(e))
    {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("bib") {
            continue;
        }
        paths.push(path.to_string_lossy().to_string());
    }
    paths.sort();
    paths
}

#[tauri::command]
pub fn list_bib_entries(
    workspace_path: String,
    cache: tauri::State<BibCache>,
) -> Vec<BibEntry> {
    scan_workspace_bibs(Path::new(&workspace_path), &cache)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bib::cache::BibCache;
    use std::fs;
    use tempfile::TempDir;

    fn sample_bib() -> &'static str {
        "@article{smith2020,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2020},\n  doi = {10.1/x},\n  keywords = {ml, nlp}\n}"
    }

    #[test]
    fn empty_workspace_returns_empty() {
        let dir = TempDir::new().unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert!(entries.is_empty());
    }

    #[test]
    fn finds_bib_in_root() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("refs.bib"), sample_bib()).unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "smith2020");
    }

    #[test]
    fn finds_bib_in_nested_dirs() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("root.bib"), sample_bib()).unwrap();
        let sub = dir.path().join("papers");
        fs::create_dir(&sub).unwrap();
        fs::write(
            sub.join("nested.bib"),
            "@book{doe2021,\n  author = {Doe, Jane},\n  title = {Beta},\n  year = {2021}\n}",
        )
        .unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries.len(), 2);
        let keys: Vec<&str> = entries.iter().map(|e| e.key.as_str()).collect();
        assert!(keys.contains(&"smith2020"));
        assert!(keys.contains(&"doe2021"));
    }

    #[test]
    fn skips_hidden_dirs() {
        let dir = TempDir::new().unwrap();
        let hidden = dir.path().join(".obsidian");
        fs::create_dir(&hidden).unwrap();
        fs::write(hidden.join("hidden.bib"), sample_bib()).unwrap();
        fs::write(dir.path().join("visible.bib"), sample_bib()).unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries.len(), 1);
        assert!(entries[0]
            .bib_file
            .as_ref()
            .unwrap()
            .ends_with("visible.bib"));
    }

    #[test]
    fn bib_file_is_absolute_path() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("refs.bib"), sample_bib()).unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        let bib_file = entries[0].bib_file.as_ref().unwrap();
        assert!(bib_file.ends_with("refs.bib"));
        assert!(Path::new(bib_file).is_absolute());
    }

    #[test]
    fn ignores_non_bib_files() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("notes.md"), "# hello").unwrap();
        fs::write(dir.path().join("data.txt"), "stuff").unwrap();
        fs::write(dir.path().join("refs.bib"), sample_bib()).unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "smith2020");
    }

    #[test]
    fn multiple_entries_in_one_file() {
        let dir = TempDir::new().unwrap();
        let two = "@article{smith2020,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2020}\n}\n\n@book{doe2021,\n  author = {Doe, Jane},\n  title = {Beta},\n  year = {2021}\n}";
        fs::write(dir.path().join("refs.bib"), two).unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn results_are_sorted_by_bib_file_then_line() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join("b.bib"),
            "@article{bbb,\n  author = {B, B},\n  title = {B},\n  year = {2020}\n}",
        )
        .unwrap();
        fs::write(
            dir.path().join("a.bib"),
            "@article{aaa,\n  author = {A, A},\n  title = {A},\n  year = {2020}\n}",
        )
        .unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries.len(), 2);
        let a_idx = entries.iter().position(|e| e.key == "aaa").unwrap();
        let b_idx = entries.iter().position(|e| e.key == "bbb").unwrap();
        assert!(a_idx < b_idx, "a.bib entries should come before b.bib");
    }

    #[test]
    fn skips_unreadable_or_non_utf8_bib() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("bad.bib"), [0xff, 0xfe, 0x00]).unwrap();
        fs::write(dir.path().join("good.bib"), sample_bib()).unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "smith2020");
    }

    #[test]
    fn warm_cache_skips_file_read() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("refs.bib");
        fs::write(&path, sample_bib()).unwrap();

        let cache = BibCache::new();

        // First scan populates the cache.
        let entries1 = scan_workspace_bibs(dir.path(), &cache);
        assert_eq!(entries1.len(), 1);
        assert_eq!(entries1[0].key, "smith2020");

        // Capture the original mtime, then overwrite the file with DIFFERENT
        // content while restoring the original mtime. A correct warm-cache path
        // must not read the new bytes.
        let orig_mtime = filetime::FileTime::from_last_modification_time(
            &fs::metadata(&path).unwrap(),
        );
        fs::write(
            &path,
            "@article{changed9999,\n  author = {New, Author},\n  title = {Changed},\n  year = {2099}\n}",
        )
        .unwrap();
        filetime::set_file_mtime(&path, orig_mtime).unwrap();

        let entries2 = scan_workspace_bibs(dir.path(), &cache);
        assert_eq!(entries2.len(), 1);
        assert_eq!(
            entries2[0].key, "smith2020",
            "warm cache must return original entry; new file content must not be read"
        );
    }

    #[test]
    fn new_metadata_fields_populated() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("refs.bib"), sample_bib()).unwrap();
        let entries = scan_workspace_bibs(dir.path(), &BibCache::new());
        assert_eq!(entries[0].doi, Some("10.1/x".to_string()));
        assert_eq!(entries[0].tags, vec!["ml", "nlp"]);
    }
}
