use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

/// Computes a deterministic cache key for a PDF file identity at a given DPI.
///
/// The key is derived from the file's canonical path, byte size, modification
/// time (in whole seconds), and render `dpi`. Any change to those inputs yields
/// a different key, so a rewritten or moved file gets a fresh cache namespace,
/// and the same file rendered at a different DPI gets its own namespace (keeping
/// `manifest.dpi` meaningful and avoiding mixed-DPI directories).
///
/// Mirrors the codebase hashing convention in `lkg/hash.rs`: hex is produced
/// via `format!("{:x}", digest)` (no `hex` crate). The full 64-char SHA-256
/// hex digest is truncated to the first 16 lowercase hex characters, which is
/// always a valid char boundary (the digest is pure ASCII).
pub fn cache_key(canonical_path: &str, file_size: u64, mtime_secs: u64, dpi: u32) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{}:{}:{}:{}", canonical_path, file_size, mtime_secs, dpi).as_bytes());
    let digest = hasher.finalize();
    let full = format!("{:x}", digest);
    full[..16].to_string()
}

/// Metadata describing a single PDF's on-disk render cache directory.
///
/// Stored as `manifest.json` inside the cache key subdirectory
/// (`pdf-render-cache/<hash>/manifest.json`). The identity fields
/// (`source_path`, `file_size`, `mtime_epoch_secs`, `dpi`) let a later open
/// validate that a found cache still matches the current file and render
/// settings before trusting its page images.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CacheManifest {
    pub source_path: String,
    pub file_size: u64,
    pub mtime_epoch_secs: u64,
    pub dpi: u32,
    pub page_count: usize,
    pub created_at: u64,
    pub last_accessed: u64,
    pub version: u32,
}

/// Writes `manifest` to `dir/manifest.json`, creating `dir` if needed.
pub fn write_manifest(dir: &Path, manifest: &CacheManifest) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    fs::write(dir.join("manifest.json"), json)
}

/// Reads `dir/manifest.json`. Returns `None` if the file is missing or fails to
/// parse, `Some(manifest)` otherwise.
pub fn read_manifest(dir: &Path) -> Option<CacheManifest> {
    let path = dir.join("manifest.json");
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

/// Sidecar index of per-page rendered pixel dimensions, keyed by
/// [`dims_key`] (`"{idx}_{dpi}"`), persisted as `dir/dims.json`.
///
/// Each PDF page can have a distinct physical size, so width/height are not
/// derivable from `dpi` alone and must be recorded at render time. This lets a
/// warm-cache scan recover `(width, height)` without re-opening and parsing the
/// PNG header of every cached page.
pub type DimsIndex = std::collections::HashMap<String, (u32, u32)>;

/// Key for the dims index: the same `{idx}_{dpi}` identity used in the
/// `page_{idx}_{dpi}.png` filename, so a scanned PNG maps directly to its entry.
pub fn dims_key(idx: usize, dpi: u32) -> String {
    format!("{idx}_{dpi}")
}

/// Reads `dir/dims.json`. Returns an empty map if the file is missing or fails
/// to parse (best-effort, like [`read_manifest`] returning `None`).
pub fn read_dims_index(dir: &Path) -> DimsIndex {
    let path = dir.join("dims.json");
    match fs::read_to_string(&path) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => DimsIndex::new(),
    }
}

/// Writes `index` to `dir/dims.json`, creating `dir` if needed.
pub fn write_dims_index(dir: &Path, index: &DimsIndex) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let json = serde_json::to_string_pretty(index)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    fs::write(dir.join("dims.json"), json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_key_deterministic() {
        let a = cache_key("/abs/foo.pdf", 1024, 1_700_000_000, 144);
        let b = cache_key("/abs/foo.pdf", 1024, 1_700_000_000, 144);
        assert_eq!(a, b);

        assert_eq!(a.len(), 16);
        for c in a.chars() {
            assert!(c.is_ascii_hexdigit());
            assert!(!c.is_ascii_uppercase());
        }
    }

    #[test]
    fn test_cache_key_changes_on_mtime() {
        assert_ne!(
            cache_key("/abs/foo.pdf", 1024, 1_700_000_000, 144),
            cache_key("/abs/foo.pdf", 1024, 1_700_000_001, 144),
        );
    }

    #[test]
    fn test_cache_key_changes_on_size() {
        assert_ne!(
            cache_key("/abs/foo.pdf", 1024, 1_700_000_000, 144),
            cache_key("/abs/foo.pdf", 2048, 1_700_000_000, 144),
        );
    }

    #[test]
    fn test_cache_key_changes_on_path() {
        assert_ne!(
            cache_key("/abs/foo.pdf", 1024, 1_700_000_000, 144),
            cache_key("/abs/bar.pdf", 1024, 1_700_000_000, 144),
        );
    }

    #[test]
    fn test_cache_key_changes_on_dpi() {
        assert_ne!(
            cache_key("/abs/foo.pdf", 1024, 1_700_000_000, 144),
            cache_key("/abs/foo.pdf", 1024, 1_700_000_000, 288),
        );
    }

    #[test]
    fn test_write_and_read_manifest() {
        let dir = tempfile::TempDir::new().unwrap();
        let m = CacheManifest {
            source_path: "/abs/foo.pdf".to_string(),
            file_size: 2048,
            mtime_epoch_secs: 1_700_000_000,
            dpi: 144,
            page_count: 12,
            created_at: 1_700_000_100,
            last_accessed: 1_700_000_200,
            version: 1,
        };
        write_manifest(dir.path(), &m).unwrap();
        let got = read_manifest(dir.path()).expect("manifest should be readable");
        assert_eq!(got, m);
        assert!(dir.path().join("manifest.json").exists());
    }

    #[test]
    fn test_dims_key_format() {
        assert_eq!(dims_key(3, 144), "3_144");
        assert_eq!(dims_key(0, 96), "0_96");
    }

    #[test]
    fn test_write_and_read_dims_index_roundtrip() {
        let dir = tempfile::TempDir::new().unwrap();
        let mut idx: DimsIndex = std::collections::HashMap::new();
        idx.insert(dims_key(0, 144), (612, 792));
        idx.insert(dims_key(1, 144), (612, 792));
        write_dims_index(dir.path(), &idx).unwrap();
        let got = read_dims_index(dir.path());
        assert_eq!(got, idx);
        assert!(dir.path().join("dims.json").exists());
    }

    #[test]
    fn test_read_dims_index_missing_returns_empty() {
        let dir = tempfile::TempDir::new().unwrap();
        let got = read_dims_index(dir.path());
        assert!(got.is_empty());
    }

    #[test]
    fn test_manifest_roundtrip_serde() {
        let m = CacheManifest {
            source_path: "/abs/bar.pdf".to_string(),
            file_size: 4096,
            mtime_epoch_secs: 1_700_111_000,
            dpi: 96,
            page_count: 7,
            created_at: 1_700_111_100,
            last_accessed: 1_700_111_200,
            version: 1,
        };
        let json = serde_json::to_string(&m).unwrap();
        let back: CacheManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(back, m);
    }
}
