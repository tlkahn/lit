use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::UNIX_EPOCH;

use rusqlite::{params, Connection, OptionalExtension};
use walkdir::WalkDir;

use crate::bib::convert::normalize_doi;
use crate::bib::types::BibEntry;
use crate::bib::writer::serialize_bib_entry;
use crate::graph::error::GraphError;

/// Outcome of an upsert_bib_item call.
#[derive(Debug, Clone, PartialEq)]
pub enum UpsertOutcome {
    /// A new row was inserted.
    Inserted { cite_key: String },
    /// An existing row was updated (includes revive-from-tombstone).
    Updated { cite_key: String },
    /// A live row with a different cite_key already holds this identifier;
    /// the caller's entry was skipped (only when from_scan=true).
    DedupSkipped { existing_key: String },
}

const SELECT_COLUMNS: &str =
    "cite_key, entry_type, title, authors, year, doi, isbn, arxiv_id, url, \
     journal, publisher, \"abstract\", issn, volume, number, pages, file, tags, \
     source_file, source_line";

fn row_to_bib_entry(row: &rusqlite::Row) -> Result<BibEntry, rusqlite::Error> {
    let authors_json: Option<String> = row.get(3)?;
    let authors: Vec<String> = authors_json
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let tags_json: Option<String> = row.get(17)?;
    let tags: Vec<String> = tags_json
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let source_line: Option<i64> = row.get(19)?;

    Ok(BibEntry {
        key: row.get(0)?,
        entry_type: row.get(1)?,
        title: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        authors,
        year: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
        doi: row.get(5)?,
        isbn: row.get(6)?,
        arxiv_id: row.get(7)?,
        url: row.get(8)?,
        journal: row.get(9)?,
        publisher: row.get(10)?,
        abstract_text: row.get(11)?,
        issn: row.get(12)?,
        volume: row.get(13)?,
        number: row.get(14)?,
        pages: row.get(15)?,
        file: row.get(16)?,
        tags,
        bib_file: row.get(18)?,
        line_number: source_line.unwrap_or(0) as usize,
    })
}

/// Check if a live row exists with the given identifier value.
/// Returns the cite_key of the matching row, if any.
fn find_live_by_field(
    conn: &Connection,
    field: &str,
    value: &str,
) -> Result<Option<String>, GraphError> {
    let sql = format!(
        "SELECT cite_key FROM bib_items WHERE {} = ?1 AND deleted_at IS NULL",
        field
    );
    let result: Option<String> = conn
        .query_row(&sql, params![value], |row| row.get(0))
        .optional()?;
    Ok(result)
}

pub fn upsert_bib_item(
    conn: &Connection,
    entry: &BibEntry,
    source_file: Option<&str>,
    source_line: Option<usize>,
    from_scan: bool,
) -> Result<UpsertOutcome, GraphError> {
    let doi = entry.doi.as_deref().map(normalize_doi);
    let isbn = entry.isbn.as_deref();
    let arxiv_id = entry.arxiv_id.as_deref();

    // Dedup precedence: doi > isbn > arxiv_id (live rows only)
    let dedup_match = if let Some(ref d) = doi {
        find_live_by_field(conn, "doi", d)?
    } else {
        None
    }
    .or(if let Some(i) = isbn {
        find_live_by_field(conn, "isbn", i)?
    } else {
        None
    })
    .or(if let Some(a) = arxiv_id {
        find_live_by_field(conn, "arxiv_id", a)?
    } else {
        None
    });

    if let Some(ref existing_key) = dedup_match {
        if existing_key != &entry.key {
            if from_scan {
                return Ok(UpsertOutcome::DedupSkipped {
                    existing_key: existing_key.clone(),
                });
            } else {
                // Non-scan: update the existing row with all fields
                update_row_full(conn, existing_key, entry, &doi, source_file, source_line)?;
                return Ok(UpsertOutcome::Updated {
                    cite_key: existing_key.clone(),
                });
            }
        }
    }

    // Cite-key match (including tombstoned)
    let existing: Option<(i64, Option<String>)> = conn
        .query_row(
            "SELECT id, deleted_at FROM bib_items WHERE cite_key = ?1",
            params![entry.key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    if let Some((_id, _deleted_at)) = existing {
        if from_scan {
            // Gap-fill: only fill NULL/empty fields, but always refresh source_file, source_line, raw_bibtex
            gap_fill_row(conn, &entry.key, entry, &doi, source_file, source_line)?;
        } else {
            update_row_full(conn, &entry.key, entry, &doi, source_file, source_line)?;
        }
        return Ok(UpsertOutcome::Updated {
            cite_key: entry.key.clone(),
        });
    }

    // No match: INSERT new row
    let authors_json = serde_json::to_string(&entry.authors)?;
    let tags_json = serde_json::to_string(&entry.tags)?;
    let raw_bibtex = serialize_bib_entry(entry);
    let sl: Option<i64> = source_line.filter(|&l| l != 0).map(|l| l as i64);

    conn.execute(
        &format!(
            "INSERT INTO bib_items ({}, raw_bibtex) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
            SELECT_COLUMNS
        ),
        params![
            entry.key,
            entry.entry_type,
            entry.title,
            authors_json,
            entry.year,
            doi,
            entry.isbn,
            entry.arxiv_id,
            entry.url,
            entry.journal,
            entry.publisher,
            entry.abstract_text,
            entry.issn,
            entry.volume,
            entry.number,
            entry.pages,
            entry.file,
            tags_json,
            source_file,
            sl,
            raw_bibtex,
        ],
    )?;

    Ok(UpsertOutcome::Inserted {
        cite_key: entry.key.clone(),
    })
}

/// Overwrite all fields of an existing row.
fn update_row_full(
    conn: &Connection,
    cite_key: &str,
    entry: &BibEntry,
    doi: &Option<String>,
    source_file: Option<&str>,
    source_line: Option<usize>,
) -> Result<(), GraphError> {
    let authors_json = serde_json::to_string(&entry.authors)?;
    let tags_json = serde_json::to_string(&entry.tags)?;
    let raw_bibtex = serialize_bib_entry(entry);
    let sl: Option<i64> = source_line.filter(|&l| l != 0).map(|l| l as i64);

    conn.execute(
        "UPDATE bib_items SET
            entry_type = ?1, title = ?2, authors = ?3, year = ?4,
            doi = ?5, isbn = ?6, arxiv_id = ?7, url = ?8,
            journal = ?9, publisher = ?10, \"abstract\" = ?11, issn = ?12,
            volume = ?13, number = ?14, pages = ?15, file = ?16,
            tags = ?17, source_file = ?18, source_line = ?19,
            raw_bibtex = ?20, deleted_at = NULL, updated_at = datetime('now')
         WHERE cite_key = ?21",
        params![
            entry.entry_type,
            entry.title,
            authors_json,
            entry.year,
            doi,
            entry.isbn,
            entry.arxiv_id,
            entry.url,
            entry.journal,
            entry.publisher,
            entry.abstract_text,
            entry.issn,
            entry.volume,
            entry.number,
            entry.pages,
            entry.file,
            tags_json,
            source_file,
            sl,
            raw_bibtex,
            cite_key,
        ],
    )?;
    Ok(())
}

/// Gap-fill: update only NULL/empty fields, but always refresh source_file,
/// source_line, and raw_bibtex. Also revive tombstoned rows.
fn gap_fill_row(
    conn: &Connection,
    cite_key: &str,
    entry: &BibEntry,
    doi: &Option<String>,
    source_file: Option<&str>,
    source_line: Option<usize>,
) -> Result<(), GraphError> {
    let authors_json = serde_json::to_string(&entry.authors)?;
    let tags_json = serde_json::to_string(&entry.tags)?;
    let raw_bibtex = serialize_bib_entry(entry);
    let sl: Option<i64> = source_line.filter(|&l| l != 0).map(|l| l as i64);

    conn.execute(
        "UPDATE bib_items SET
            entry_type = COALESCE(NULLIF(entry_type, ''), ?1),
            title = COALESCE(NULLIF(title, ''), ?2),
            authors = COALESCE(NULLIF(authors, ''), COALESCE(NULLIF(authors, '[]'), ?3)),
            year = COALESCE(NULLIF(year, ''), ?4),
            doi = COALESCE(doi, ?5),
            isbn = COALESCE(isbn, ?6),
            arxiv_id = COALESCE(arxiv_id, ?7),
            url = COALESCE(url, ?8),
            journal = COALESCE(journal, ?9),
            publisher = COALESCE(publisher, ?10),
            \"abstract\" = COALESCE(\"abstract\", ?11),
            issn = COALESCE(issn, ?12),
            volume = COALESCE(volume, ?13),
            number = COALESCE(number, ?14),
            pages = COALESCE(pages, ?15),
            file = COALESCE(file, ?16),
            tags = COALESCE(NULLIF(tags, ''), COALESCE(NULLIF(tags, '[]'), ?17)),
            source_file = ?18,
            source_line = ?19,
            raw_bibtex = ?20,
            deleted_at = NULL,
            updated_at = datetime('now')
         WHERE cite_key = ?21",
        params![
            entry.entry_type,
            entry.title,
            authors_json,
            entry.year,
            doi,
            entry.isbn,
            entry.arxiv_id,
            entry.url,
            entry.journal,
            entry.publisher,
            entry.abstract_text,
            entry.issn,
            entry.volume,
            entry.number,
            entry.pages,
            entry.file,
            tags_json,
            source_file,
            sl,
            raw_bibtex,
            cite_key,
        ],
    )?;
    Ok(())
}

pub fn get_bib_item(
    conn: &Connection,
    cite_key: &str,
) -> Result<Option<BibEntry>, GraphError> {
    let sql = format!(
        "SELECT {} FROM bib_items WHERE cite_key = ?1 AND deleted_at IS NULL",
        SELECT_COLUMNS
    );
    let result = conn
        .query_row(&sql, params![cite_key], |row| row_to_bib_entry(row))
        .optional()?;
    Ok(result)
}

pub fn list_bib_items(conn: &Connection) -> Result<Vec<BibEntry>, GraphError> {
    let sql = format!(
        "SELECT {} FROM bib_items WHERE deleted_at IS NULL ORDER BY cite_key",
        SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql)?;
    let entries = stmt
        .query_map([], |row| row_to_bib_entry(row))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(entries)
}

pub fn search_bib_items(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<BibEntry>, GraphError> {
    let pattern = format!("%{}%", query);
    let sql = format!(
        "SELECT {} FROM bib_items WHERE deleted_at IS NULL \
         AND (cite_key LIKE ?1 OR title LIKE ?1 OR authors LIKE ?1 \
              OR year LIKE ?1 OR doi LIKE ?1) \
         ORDER BY cite_key LIMIT ?2",
        SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql)?;
    let entries = stmt
        .query_map(params![pattern, limit as i64], |row| row_to_bib_entry(row))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(entries)
}

pub fn update_bib_fields(
    conn: &Connection,
    cite_key: &str,
    fields: &HashMap<String, String>,
) -> Result<bool, GraphError> {
    // Read current entry
    let current = get_bib_item(conn, cite_key)?;
    let Some(mut entry) = current else {
        return Ok(false);
    };

    // Apply field updates
    for (field, value) in fields {
        match field.as_str() {
            "title" => entry.title = value.clone(),
            "authors" => {
                entry.authors = serde_json::from_str(value).unwrap_or_else(|_| vec![value.clone()]);
            }
            "year" => entry.year = value.clone(),
            "doi" => entry.doi = Some(value.clone()),
            "isbn" => entry.isbn = Some(value.clone()),
            "arxiv_id" => entry.arxiv_id = Some(value.clone()),
            "url" => entry.url = Some(value.clone()),
            "journal" => entry.journal = Some(value.clone()),
            "publisher" => entry.publisher = Some(value.clone()),
            "abstract" => entry.abstract_text = Some(value.clone()),
            "issn" => entry.issn = Some(value.clone()),
            "volume" => entry.volume = Some(value.clone()),
            "number" => entry.number = Some(value.clone()),
            "pages" => entry.pages = Some(value.clone()),
            "file" => entry.file = Some(value.clone()),
            _ => {} // unknown fields silently ignored
        }
    }

    let authors_json = serde_json::to_string(&entry.authors)?;
    let tags_json = serde_json::to_string(&entry.tags)?;
    let raw_bibtex = serialize_bib_entry(&entry);

    let rows = conn.execute(
        "UPDATE bib_items SET
            entry_type = ?1, title = ?2, authors = ?3, year = ?4,
            doi = ?5, isbn = ?6, arxiv_id = ?7, url = ?8,
            journal = ?9, publisher = ?10, \"abstract\" = ?11, issn = ?12,
            volume = ?13, number = ?14, pages = ?15, file = ?16,
            tags = ?17, raw_bibtex = ?18, updated_at = datetime('now')
         WHERE cite_key = ?19 AND deleted_at IS NULL",
        params![
            entry.entry_type,
            entry.title,
            authors_json,
            entry.year,
            entry.doi,
            entry.isbn,
            entry.arxiv_id,
            entry.url,
            entry.journal,
            entry.publisher,
            entry.abstract_text,
            entry.issn,
            entry.volume,
            entry.number,
            entry.pages,
            entry.file,
            tags_json,
            raw_bibtex,
            cite_key,
        ],
    )?;

    Ok(rows > 0)
}

pub fn tombstone_bib_item(
    conn: &Connection,
    cite_key: &str,
) -> Result<bool, GraphError> {
    let rows = conn.execute(
        "UPDATE bib_items SET deleted_at = datetime('now'), updated_at = datetime('now') \
         WHERE cite_key = ?1 AND deleted_at IS NULL",
        params![cite_key],
    )?;
    Ok(rows > 0)
}

pub fn all_live_keys(conn: &Connection) -> Result<HashSet<String>, GraphError> {
    let mut stmt = conn.prepare("SELECT cite_key FROM bib_items WHERE deleted_at IS NULL")?;
    let keys = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<HashSet<String>, _>>()?;
    Ok(keys)
}

// ---------------------------------------------------------------------------
// Mtime-ledger helpers
// ---------------------------------------------------------------------------

pub fn get_source_mtime(conn: &Connection, path: &str) -> Result<Option<i64>, GraphError> {
    let result: Option<i64> = conn
        .query_row(
            "SELECT mtime FROM bib_source_files WHERE path = ?1",
            params![path],
            |row| row.get(0),
        )
        .optional()?;
    Ok(result)
}

pub fn update_source_ledger(conn: &Connection, path: &str, mtime: i64) -> Result<(), GraphError> {
    conn.execute(
        "INSERT OR REPLACE INTO bib_source_files (path, mtime, last_ingested) VALUES (?1, ?2, datetime('now'))",
        params![path, mtime],
    )?;
    Ok(())
}

pub fn prune_source_ledger(
    conn: &Connection,
    keep_paths: &HashSet<String>,
) -> Result<usize, GraphError> {
    let mut stmt = conn.prepare("SELECT path FROM bib_source_files")?;
    let all_paths: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut pruned = 0usize;
    for path in &all_paths {
        if !keep_paths.contains(path) {
            conn.execute("DELETE FROM bib_source_files WHERE path = ?1", params![path])?;
            pruned += 1;
        }
    }
    Ok(pruned)
}

// ---------------------------------------------------------------------------
// Workspace bib ingest
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
pub struct IngestStats {
    pub files_scanned: usize,
    pub files_skipped: usize,
    pub entries_inserted: usize,
    pub entries_updated: usize,
    pub entries_dedup_skipped: usize,
    pub ledger_pruned: usize,
}

/// Walk all `.bib` files under `root`, skip unchanged ones (mtime matches
/// `bib_source_files` ledger), parse changed/new ones via BibCache, upsert
/// entries via `upsert_bib_item(..., from_scan=true)`, update the ledger, and
/// prune ledger rows for `.bib` files no longer on disk.
pub fn ingest_workspace_bibs(
    conn: &Connection,
    root: &Path,
    cache: &crate::bib::cache::BibCache,
) -> Result<IngestStats, GraphError> {
    let mut stats = IngestStats::default();
    let mut seen_paths = HashSet::new();

    for dir_entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !crate::util::is_hidden(e))
    {
        let dir_entry = match dir_entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !dir_entry.file_type().is_file() {
            continue;
        }
        let path = dir_entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("bib") {
            continue;
        }

        let path_str = path.to_string_lossy().to_string();
        seen_paths.insert(path_str.clone());

        let mtime_systime = dir_entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(UNIX_EPOCH);
        let mtime_i64 = mtime_systime
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        if let Some(stored_mtime) = get_source_mtime(conn, &path_str)? {
            if stored_mtime == mtime_i64 {
                stats.files_skipped += 1;
                continue;
            }
        }

        let path_buf = path.to_path_buf();
        let entries = cache.get_or_parse_with(&path_buf, mtime_systime, || {
            std::fs::read_to_string(path).ok()
        });

        for entry in &entries {
            let outcome = upsert_bib_item(
                conn,
                entry,
                Some(&path_str),
                Some(entry.line_number),
                true,
            )?;
            match outcome {
                UpsertOutcome::Inserted { .. } => stats.entries_inserted += 1,
                UpsertOutcome::Updated { .. } => stats.entries_updated += 1,
                UpsertOutcome::DedupSkipped { .. } => stats.entries_dedup_skipped += 1,
            }
        }

        update_source_ledger(conn, &path_str, mtime_i64)?;
        stats.files_scanned += 1;
    }

    stats.ledger_pruned = prune_source_ledger(conn, &seen_paths)?;
    Ok(stats)
}

pub fn live_index(conn: &Connection) -> Result<HashMap<String, BibEntry>, GraphError> {
    let sql = format!(
        "SELECT {} FROM bib_items WHERE deleted_at IS NULL ORDER BY cite_key",
        SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql)?;
    let entries = stmt
        .query_map([], |row| row_to_bib_entry(row))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut map = HashMap::with_capacity(entries.len());
    for entry in entries {
        map.insert(entry.key.clone(), entry);
    }
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::store::Store;

    fn test_entry(key: &str) -> BibEntry {
        BibEntry {
            key: key.to_string(),
            entry_type: "article".to_string(),
            title: format!("Title for {}", key),
            authors: vec!["Author, Test".to_string()],
            year: "2024".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: None,
            isbn: None,
            arxiv_id: None,
            url: None,
            journal: None,
            publisher: None,
            issn: None,
            volume: None,
            number: None,
            pages: None,
            file: None,
            tags: vec![],
        }
    }

    fn test_entry_with_doi(key: &str, doi: &str) -> BibEntry {
        let mut e = test_entry(key);
        e.doi = Some(doi.to_string());
        e
    }

    // ── Upsert tests ──────────────────────────────────────────────

    #[test]
    fn test_upsert_insert_new_entry() {
        let store = Store::open_memory().unwrap();
        let entry = test_entry("smith2024");
        let result = upsert_bib_item(&store.conn, &entry, Some("refs.bib"), Some(10), false).unwrap();
        assert_eq!(result, UpsertOutcome::Inserted { cite_key: "smith2024".to_string() });

        let fetched = get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.key, "smith2024");
        assert_eq!(fetched.title, "Title for smith2024");
        assert_eq!(fetched.authors, vec!["Author, Test"]);
        assert_eq!(fetched.year, "2024");
        assert_eq!(fetched.entry_type, "article");
        assert_eq!(fetched.bib_file, Some("refs.bib".to_string()));
        assert_eq!(fetched.line_number, 10);
    }

    #[test]
    fn test_upsert_dedup_by_doi() {
        let store = Store::open_memory().unwrap();
        let a = test_entry_with_doi("entryA", "10.1000/x");
        upsert_bib_item(&store.conn, &a, None, None, false).unwrap();

        let b = test_entry_with_doi("entryB", "10.1000/x");
        let result = upsert_bib_item(&store.conn, &b, None, None, true).unwrap();
        assert_eq!(
            result,
            UpsertOutcome::DedupSkipped { existing_key: "entryA".to_string() }
        );
    }

    #[test]
    fn test_upsert_dedup_by_doi_non_scan_updates() {
        let store = Store::open_memory().unwrap();
        let a = test_entry_with_doi("entryA", "10.1000/x");
        upsert_bib_item(&store.conn, &a, None, None, false).unwrap();

        let mut b = test_entry_with_doi("entryB", "10.1000/x");
        b.title = "Updated Title".to_string();
        let result = upsert_bib_item(&store.conn, &b, None, None, false).unwrap();
        assert_eq!(
            result,
            UpsertOutcome::Updated { cite_key: "entryA".to_string() }
        );

        let fetched = get_bib_item(&store.conn, "entryA").unwrap().unwrap();
        assert_eq!(fetched.title, "Updated Title");
    }

    #[test]
    fn test_upsert_dedup_by_isbn() {
        let store = Store::open_memory().unwrap();
        let mut a = test_entry("entryA");
        a.isbn = Some("978-3-16-148410-0".to_string());
        upsert_bib_item(&store.conn, &a, None, None, false).unwrap();

        let mut b = test_entry("entryB");
        b.isbn = Some("978-3-16-148410-0".to_string());
        let result = upsert_bib_item(&store.conn, &b, None, None, true).unwrap();
        assert_eq!(
            result,
            UpsertOutcome::DedupSkipped { existing_key: "entryA".to_string() }
        );
    }

    #[test]
    fn test_upsert_dedup_by_arxiv_id() {
        let store = Store::open_memory().unwrap();
        let mut a = test_entry("entryA");
        a.arxiv_id = Some("2301.12345".to_string());
        upsert_bib_item(&store.conn, &a, None, None, false).unwrap();

        let mut b = test_entry("entryB");
        b.arxiv_id = Some("2301.12345".to_string());
        let result = upsert_bib_item(&store.conn, &b, None, None, true).unwrap();
        assert_eq!(
            result,
            UpsertOutcome::DedupSkipped { existing_key: "entryA".to_string() }
        );
    }

    #[test]
    fn test_upsert_dedup_precedence_doi_over_isbn() {
        let store = Store::open_memory().unwrap();
        let mut a = test_entry("entryA");
        a.doi = Some("10.1000/x".to_string());
        a.isbn = Some("978-OLD".to_string());
        upsert_bib_item(&store.conn, &a, None, None, false).unwrap();

        let mut b = test_entry("entryB");
        b.doi = Some("10.1000/x".to_string());
        b.isbn = Some("978-NEW".to_string()); // different isbn
        let result = upsert_bib_item(&store.conn, &b, None, None, true).unwrap();
        // Should dedup on DOI first, not reach isbn check
        assert_eq!(
            result,
            UpsertOutcome::DedupSkipped { existing_key: "entryA".to_string() }
        );
    }

    #[test]
    fn test_upsert_same_key_updates() {
        let store = Store::open_memory().unwrap();
        let a = test_entry("smith2024");
        upsert_bib_item(&store.conn, &a, None, None, false).unwrap();

        let mut a2 = test_entry("smith2024");
        a2.title = "New Title".to_string();
        let result = upsert_bib_item(&store.conn, &a2, None, None, false).unwrap();
        assert_eq!(result, UpsertOutcome::Updated { cite_key: "smith2024".to_string() });

        let fetched = get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.title, "New Title");
    }

    #[test]
    fn test_upsert_revive_tombstoned_entry() {
        let store = Store::open_memory().unwrap();
        let a = test_entry("smith2024");
        upsert_bib_item(&store.conn, &a, None, None, false).unwrap();
        tombstone_bib_item(&store.conn, "smith2024").unwrap();
        assert!(get_bib_item(&store.conn, "smith2024").unwrap().is_none());

        let mut a2 = test_entry("smith2024");
        a2.title = "Revived".to_string();
        let result = upsert_bib_item(&store.conn, &a2, None, None, false).unwrap();
        assert_eq!(result, UpsertOutcome::Updated { cite_key: "smith2024".to_string() });

        let fetched = get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.title, "Revived");
    }

    #[test]
    fn test_upsert_from_scan_gap_fill() {
        let store = Store::open_memory().unwrap();
        let mut a = test_entry("smith2024");
        a.title = "Original".to_string();
        a.doi = None;
        upsert_bib_item(&store.conn, &a, None, None, false).unwrap();

        let mut scan = test_entry("smith2024");
        scan.title = "Scanned".to_string();
        scan.doi = Some("10.1/new".to_string());
        let result = upsert_bib_item(&store.conn, &scan, None, None, true).unwrap();
        assert_eq!(result, UpsertOutcome::Updated { cite_key: "smith2024".to_string() });

        let fetched = get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.title, "Original"); // non-empty, not overwritten
        assert_eq!(fetched.doi, Some("10.1/new".to_string())); // was NULL, filled
    }

    #[test]
    fn test_upsert_from_scan_refreshes_source_file() {
        let store = Store::open_memory().unwrap();
        let a = test_entry("smith2024");
        upsert_bib_item(&store.conn, &a, Some("old.bib"), None, false).unwrap();

        let scan = test_entry("smith2024");
        upsert_bib_item(&store.conn, &scan, Some("new.bib"), None, true).unwrap();

        let fetched = get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.bib_file, Some("new.bib".to_string()));
    }

    #[test]
    fn test_upsert_from_scan_refreshes_raw_bibtex() {
        let store = Store::open_memory().unwrap();
        let a = test_entry("smith2024");
        upsert_bib_item(&store.conn, &a, None, None, false).unwrap();

        let mut scan = test_entry("smith2024");
        scan.doi = Some("10.1/added".to_string());
        upsert_bib_item(&store.conn, &scan, None, None, true).unwrap();

        // raw_bibtex should contain the new doi since it's always refreshed
        let raw: String = store
            .conn
            .query_row(
                "SELECT raw_bibtex FROM bib_items WHERE cite_key = 'smith2024'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(raw.contains("10.1/added"), "raw_bibtex should be refreshed on scan");
    }

    #[test]
    fn test_upsert_non_scan_overwrites_all() {
        let store = Store::open_memory().unwrap();
        let mut a = test_entry("smith2024");
        a.title = "Old".to_string();
        upsert_bib_item(&store.conn, &a, None, None, false).unwrap();

        let mut b = test_entry("smith2024");
        b.title = "New".to_string();
        upsert_bib_item(&store.conn, &b, None, None, false).unwrap();

        let fetched = get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.title, "New");
    }

    #[test]
    fn test_upsert_doi_normalized() {
        let store = Store::open_memory().unwrap();
        let mut a = test_entry("smith2024");
        a.doi = Some("https://doi.org/10.1000/x".to_string());
        upsert_bib_item(&store.conn, &a, None, None, false).unwrap();

        let fetched = get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.doi, Some("10.1000/x".to_string()));
    }

    #[test]
    fn test_upsert_dedup_ignores_tombstoned_rows() {
        let store = Store::open_memory().unwrap();
        let a = test_entry_with_doi("entryA", "10.1000/x");
        upsert_bib_item(&store.conn, &a, None, None, false).unwrap();
        tombstone_bib_item(&store.conn, "entryA").unwrap();

        let b = test_entry_with_doi("entryB", "10.1000/x");
        let result = upsert_bib_item(&store.conn, &b, None, None, false).unwrap();
        assert_eq!(result, UpsertOutcome::Inserted { cite_key: "entryB".to_string() });
    }

    // ── Get/List/Search tests ─────────────────────────────────────

    #[test]
    fn test_get_bib_item_found() {
        let store = Store::open_memory().unwrap();
        let mut e = test_entry("smith2024");
        e.doi = Some("10.1/test".to_string());
        e.journal = Some("Nature".to_string());
        e.abstract_text = Some("Abstract text".to_string());
        upsert_bib_item(&store.conn, &e, Some("refs.bib"), Some(5), false).unwrap();

        let fetched = get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.key, "smith2024");
        assert_eq!(fetched.doi, Some("10.1/test".to_string()));
        assert_eq!(fetched.journal, Some("Nature".to_string()));
        assert_eq!(fetched.abstract_text, Some("Abstract text".to_string()));
        assert_eq!(fetched.bib_file, Some("refs.bib".to_string()));
        assert_eq!(fetched.line_number, 5);
    }

    #[test]
    fn test_get_bib_item_not_found() {
        let store = Store::open_memory().unwrap();
        assert!(get_bib_item(&store.conn, "nonexistent").unwrap().is_none());
    }

    #[test]
    fn test_get_bib_item_tombstoned_invisible() {
        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        upsert_bib_item(&store.conn, &e, None, None, false).unwrap();
        tombstone_bib_item(&store.conn, "smith2024").unwrap();
        assert!(get_bib_item(&store.conn, "smith2024").unwrap().is_none());
    }

    #[test]
    fn test_list_bib_items_empty() {
        let store = Store::open_memory().unwrap();
        assert!(list_bib_items(&store.conn).unwrap().is_empty());
    }

    #[test]
    fn test_list_bib_items_excludes_tombstoned() {
        let store = Store::open_memory().unwrap();
        for key in &["a2024", "b2024", "c2024"] {
            let e = test_entry(key);
            upsert_bib_item(&store.conn, &e, None, None, false).unwrap();
        }
        tombstone_bib_item(&store.conn, "b2024").unwrap();
        assert_eq!(list_bib_items(&store.conn).unwrap().len(), 2);
    }

    #[test]
    fn test_list_bib_items_ordered_by_cite_key() {
        let store = Store::open_memory().unwrap();
        for key in &["charlie", "alpha", "bravo"] {
            let e = test_entry(key);
            upsert_bib_item(&store.conn, &e, None, None, false).unwrap();
        }
        let items = list_bib_items(&store.conn).unwrap();
        let keys: Vec<&str> = items.iter().map(|e| e.key.as_str()).collect();
        assert_eq!(keys, vec!["alpha", "bravo", "charlie"]);
    }

    #[test]
    fn test_search_bib_items_by_title() {
        let store = Store::open_memory().unwrap();
        let mut e1 = test_entry("a2024");
        e1.title = "Machine Learning Overview".to_string();
        upsert_bib_item(&store.conn, &e1, None, None, false).unwrap();
        let mut e2 = test_entry("b2024");
        e2.title = "Quantum Computing".to_string();
        upsert_bib_item(&store.conn, &e2, None, None, false).unwrap();

        let results = search_bib_items(&store.conn, "Machine", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].key, "a2024");
    }

    #[test]
    fn test_search_bib_items_by_author() {
        let store = Store::open_memory().unwrap();
        let mut e = test_entry("a2024");
        e.authors = vec!["Einstein, Albert".to_string()];
        upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let results = search_bib_items(&store.conn, "Einstein", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].key, "a2024");
    }

    #[test]
    fn test_search_bib_items_respects_limit() {
        let store = Store::open_memory().unwrap();
        for i in 0..5 {
            let e = test_entry(&format!("entry{}", i));
            upsert_bib_item(&store.conn, &e, None, None, false).unwrap();
        }
        let results = search_bib_items(&store.conn, "entry", 2).unwrap();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_search_bib_items_excludes_tombstoned() {
        let store = Store::open_memory().unwrap();
        let mut e = test_entry("a2024");
        e.title = "Unique Searchable Title".to_string();
        upsert_bib_item(&store.conn, &e, None, None, false).unwrap();
        tombstone_bib_item(&store.conn, "a2024").unwrap();

        let results = search_bib_items(&store.conn, "Unique Searchable", 10).unwrap();
        assert!(results.is_empty());
    }

    // ── Update tests ──────────────────────────────────────────────

    #[test]
    fn test_update_bib_fields_changes_title() {
        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let mut fields = HashMap::new();
        fields.insert("title".to_string(), "Brand New Title".to_string());
        assert!(update_bib_fields(&store.conn, "smith2024", &fields).unwrap());

        let fetched = get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.title, "Brand New Title");

        // raw_bibtex should also be re-serialized
        let raw: String = store
            .conn
            .query_row(
                "SELECT raw_bibtex FROM bib_items WHERE cite_key = 'smith2024'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(raw.contains("Brand New Title"));
    }

    #[test]
    fn test_update_bib_fields_nonexistent_key() {
        let store = Store::open_memory().unwrap();
        let mut fields = HashMap::new();
        fields.insert("title".to_string(), "X".to_string());
        assert!(!update_bib_fields(&store.conn, "nonexistent", &fields).unwrap());
    }

    #[test]
    fn test_update_bib_fields_tombstoned_key() {
        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        upsert_bib_item(&store.conn, &e, None, None, false).unwrap();
        tombstone_bib_item(&store.conn, "smith2024").unwrap();

        let mut fields = HashMap::new();
        fields.insert("title".to_string(), "X".to_string());
        assert!(!update_bib_fields(&store.conn, "smith2024", &fields).unwrap());
    }

    #[test]
    fn test_update_bib_fields_multiple_fields() {
        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        upsert_bib_item(&store.conn, &e, None, None, false).unwrap();

        let mut fields = HashMap::new();
        fields.insert("title".to_string(), "New Title".to_string());
        fields.insert("doi".to_string(), "10.1/new".to_string());
        assert!(update_bib_fields(&store.conn, "smith2024", &fields).unwrap());

        let fetched = get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.title, "New Title");
        assert_eq!(fetched.doi, Some("10.1/new".to_string()));
    }

    // ── Tombstone tests ───────────────────────────────────────────

    #[test]
    fn test_tombstone_bib_item_success() {
        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        upsert_bib_item(&store.conn, &e, None, None, false).unwrap();
        assert!(tombstone_bib_item(&store.conn, "smith2024").unwrap());
        assert!(get_bib_item(&store.conn, "smith2024").unwrap().is_none());
    }

    #[test]
    fn test_tombstone_bib_item_not_found() {
        let store = Store::open_memory().unwrap();
        assert!(!tombstone_bib_item(&store.conn, "nonexistent").unwrap());
    }

    #[test]
    fn test_tombstone_bib_item_already_tombstoned() {
        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        upsert_bib_item(&store.conn, &e, None, None, false).unwrap();
        tombstone_bib_item(&store.conn, "smith2024").unwrap();
        assert!(!tombstone_bib_item(&store.conn, "smith2024").unwrap());
    }

    // ── Bulk query tests ──────────────────────────────────────────

    #[test]
    fn test_all_live_keys() {
        let store = Store::open_memory().unwrap();
        for key in &["a2024", "b2024", "c2024"] {
            let e = test_entry(key);
            upsert_bib_item(&store.conn, &e, None, None, false).unwrap();
        }
        tombstone_bib_item(&store.conn, "b2024").unwrap();
        let keys = all_live_keys(&store.conn).unwrap();
        assert_eq!(keys.len(), 2);
        assert!(keys.contains("a2024"));
        assert!(keys.contains("c2024"));
    }

    #[test]
    fn test_live_index() {
        let store = Store::open_memory().unwrap();
        for key in &["a2024", "b2024", "c2024"] {
            let e = test_entry(key);
            upsert_bib_item(&store.conn, &e, None, None, false).unwrap();
        }
        tombstone_bib_item(&store.conn, "b2024").unwrap();
        let index = live_index(&store.conn).unwrap();
        assert_eq!(index.len(), 2);
        assert!(index.contains_key("a2024"));
        assert!(index.contains_key("c2024"));
        assert_eq!(index["a2024"].title, "Title for a2024");
    }

    // ── JSON roundtrip tests ──────────────────────────────────────

    #[test]
    fn test_json_roundtrip_authors() {
        let store = Store::open_memory().unwrap();
        let mut e = test_entry("smith2024");
        e.authors = vec![
            "Smith, John".to_string(),
            "Doe, Jane".to_string(),
            "WHO".to_string(),
        ];
        upsert_bib_item(&store.conn, &e, None, None, false).unwrap();
        let fetched = get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.authors, vec!["Smith, John", "Doe, Jane", "WHO"]);
    }

    #[test]
    fn test_json_roundtrip_tags() {
        let store = Store::open_memory().unwrap();
        let mut e = test_entry("smith2024");
        e.tags = vec!["ml".to_string(), "nlp".to_string(), "ai".to_string()];
        upsert_bib_item(&store.conn, &e, None, None, false).unwrap();
        let fetched = get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.tags, vec!["ml", "nlp", "ai"]);
    }

    #[test]
    fn test_json_roundtrip_empty_authors_and_tags() {
        let store = Store::open_memory().unwrap();
        let mut e = test_entry("smith2024");
        e.authors = vec![];
        e.tags = vec![];
        upsert_bib_item(&store.conn, &e, None, None, false).unwrap();
        let fetched = get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert!(fetched.authors.is_empty());
        assert!(fetched.tags.is_empty());
    }

    #[test]
    fn test_source_file_line_mapping() {
        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        upsert_bib_item(&store.conn, &e, Some("foo.bib"), Some(42), false).unwrap();
        let fetched = get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.bib_file, Some("foo.bib".to_string()));
        assert_eq!(fetched.line_number, 42);
    }

    #[test]
    fn test_source_file_line_null_mapping() {
        let store = Store::open_memory().unwrap();
        let e = test_entry("smith2024");
        upsert_bib_item(&store.conn, &e, None, None, false).unwrap();
        let fetched = get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.bib_file, None);
        assert_eq!(fetched.line_number, 0);
    }

    // ── Mtime-ledger tests ───────────────────────────────────────

    #[test]
    fn test_update_source_ledger_insert_and_get() {
        let store = Store::open_memory().unwrap();
        update_source_ledger(&store.conn, "/workspace/refs.bib", 1700000000).unwrap();
        let mtime = get_source_mtime(&store.conn, "/workspace/refs.bib").unwrap();
        assert_eq!(mtime, Some(1700000000));
    }

    #[test]
    fn test_update_source_ledger_upsert() {
        let store = Store::open_memory().unwrap();
        update_source_ledger(&store.conn, "/workspace/refs.bib", 1700000000).unwrap();
        update_source_ledger(&store.conn, "/workspace/refs.bib", 1700000099).unwrap();
        let mtime = get_source_mtime(&store.conn, "/workspace/refs.bib").unwrap();
        assert_eq!(mtime, Some(1700000099));
        // No duplicates
        let count: i64 = store.conn.query_row(
            "SELECT COUNT(*) FROM bib_source_files WHERE path = '/workspace/refs.bib'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_get_source_mtime_not_found() {
        let store = Store::open_memory().unwrap();
        let mtime = get_source_mtime(&store.conn, "/nonexistent.bib").unwrap();
        assert_eq!(mtime, None);
    }

    #[test]
    fn test_prune_source_ledger_removes_absent() {
        let store = Store::open_memory().unwrap();
        update_source_ledger(&store.conn, "/a.bib", 100).unwrap();
        update_source_ledger(&store.conn, "/b.bib", 200).unwrap();
        update_source_ledger(&store.conn, "/c.bib", 300).unwrap();
        let keep: HashSet<String> = ["/a.bib", "/b.bib"].iter().map(|s| s.to_string()).collect();
        let pruned = prune_source_ledger(&store.conn, &keep).unwrap();
        assert_eq!(pruned, 1);
        assert_eq!(get_source_mtime(&store.conn, "/c.bib").unwrap(), None);
        assert!(get_source_mtime(&store.conn, "/a.bib").unwrap().is_some());
    }

    #[test]
    fn test_prune_source_ledger_no_prune() {
        let store = Store::open_memory().unwrap();
        update_source_ledger(&store.conn, "/a.bib", 100).unwrap();
        update_source_ledger(&store.conn, "/b.bib", 200).unwrap();
        let keep: HashSet<String> = ["/a.bib", "/b.bib"].iter().map(|s| s.to_string()).collect();
        let pruned = prune_source_ledger(&store.conn, &keep).unwrap();
        assert_eq!(pruned, 0);
    }

    // ── Ingest tests ─────────────────────────────────────────────

    fn write_bib_file(root: &std::path::Path, rel: &str, content: &str) {
        let abs = root.join(rel);
        if let Some(p) = abs.parent() {
            std::fs::create_dir_all(p).unwrap();
        }
        std::fs::write(abs, content).unwrap();
    }

    fn bump_mtime(path: &std::path::Path) {
        let meta = std::fs::metadata(path).unwrap();
        let current = filetime::FileTime::from_last_modification_time(&meta);
        let bumped = filetime::FileTime::from_unix_time(current.unix_seconds() + 2, 0);
        filetime::set_file_mtime(path, bumped).unwrap();
    }

    #[test]
    fn test_ingest_workspace_bibs_cold_start() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open_memory().unwrap();
        let cache = crate::bib::cache::BibCache::new();

        write_bib_file(dir.path(), "refs.bib",
            "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}\n\
             @article{jones2023,\n  author = {Jones},\n  title = {Beta},\n  year = {2023}\n}");
        write_bib_file(dir.path(), "extra.bib",
            "@book{doe2022,\n  author = {Doe},\n  title = {Gamma},\n  year = {2022}\n}");

        let stats = ingest_workspace_bibs(&store.conn, dir.path(), &cache).unwrap();
        assert_eq!(stats.files_scanned, 2);
        assert_eq!(stats.files_skipped, 0);
        assert_eq!(stats.entries_inserted, 3);

        let items = list_bib_items(&store.conn).unwrap();
        assert_eq!(items.len(), 3);
    }

    #[test]
    fn test_ingest_workspace_bibs_mtime_skip() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open_memory().unwrap();
        let cache = crate::bib::cache::BibCache::new();

        write_bib_file(dir.path(), "refs.bib",
            "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}");
        write_bib_file(dir.path(), "extra.bib",
            "@book{doe2022,\n  author = {Doe},\n  title = {Gamma},\n  year = {2022}\n}");

        ingest_workspace_bibs(&store.conn, dir.path(), &cache).unwrap();

        let stats2 = ingest_workspace_bibs(&store.conn, dir.path(), &cache).unwrap();
        assert_eq!(stats2.files_skipped, 2);
        assert_eq!(stats2.files_scanned, 0);
        assert_eq!(list_bib_items(&store.conn).unwrap().len(), 2);
    }

    #[test]
    fn test_ingest_workspace_bibs_changed_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open_memory().unwrap();
        let cache = crate::bib::cache::BibCache::new();

        write_bib_file(dir.path(), "refs.bib",
            "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}");
        write_bib_file(dir.path(), "extra.bib",
            "@book{doe2022,\n  author = {Doe},\n  title = {Gamma},\n  year = {2022}\n}");

        ingest_workspace_bibs(&store.conn, dir.path(), &cache).unwrap();

        // Modify refs.bib to add an entry
        write_bib_file(dir.path(), "refs.bib",
            "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}\n\
             @article{new2025,\n  author = {New},\n  title = {Delta},\n  year = {2025}\n}");
        bump_mtime(&dir.path().join("refs.bib"));

        let stats2 = ingest_workspace_bibs(&store.conn, dir.path(), &cache).unwrap();
        assert_eq!(stats2.files_scanned, 1);
        assert_eq!(stats2.files_skipped, 1);
        assert_eq!(list_bib_items(&store.conn).unwrap().len(), 3);
    }

    #[test]
    fn test_ingest_workspace_bibs_deleted_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open_memory().unwrap();
        let cache = crate::bib::cache::BibCache::new();

        write_bib_file(dir.path(), "refs.bib",
            "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}");
        write_bib_file(dir.path(), "extra.bib",
            "@book{doe2022,\n  author = {Doe},\n  title = {Gamma},\n  year = {2022}\n}");

        ingest_workspace_bibs(&store.conn, dir.path(), &cache).unwrap();

        std::fs::remove_file(dir.path().join("extra.bib")).unwrap();

        let stats2 = ingest_workspace_bibs(&store.conn, dir.path(), &cache).unwrap();
        assert_eq!(stats2.ledger_pruned, 1);
        // bib_items rows from deleted file remain (stale but acceptable)
        assert_eq!(list_bib_items(&store.conn).unwrap().len(), 2);
    }

    #[test]
    fn test_ingest_workspace_bibs_no_tombstone_resurrection() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open_memory().unwrap();
        let cache = crate::bib::cache::BibCache::new();

        write_bib_file(dir.path(), "refs.bib",
            "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}");

        ingest_workspace_bibs(&store.conn, dir.path(), &cache).unwrap();
        tombstone_bib_item(&store.conn, "smith2024").unwrap();
        assert!(get_bib_item(&store.conn, "smith2024").unwrap().is_none());

        // Re-ingest without touching the file -- mtime matches, file skipped
        let stats2 = ingest_workspace_bibs(&store.conn, dir.path(), &cache).unwrap();
        assert_eq!(stats2.files_skipped, 1);
        assert!(get_bib_item(&store.conn, "smith2024").unwrap().is_none(),
            "tombstoned entry must remain tombstoned when file is unchanged");
    }

    #[test]
    fn test_ingest_workspace_bibs_tombstone_revive_on_change() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open_memory().unwrap();
        let cache = crate::bib::cache::BibCache::new();

        write_bib_file(dir.path(), "refs.bib",
            "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}");

        ingest_workspace_bibs(&store.conn, dir.path(), &cache).unwrap();
        tombstone_bib_item(&store.conn, "smith2024").unwrap();

        // Bump the file mtime to force re-parse
        bump_mtime(&dir.path().join("refs.bib"));

        let stats2 = ingest_workspace_bibs(&store.conn, dir.path(), &cache).unwrap();
        assert_eq!(stats2.files_scanned, 1);
        assert!(get_bib_item(&store.conn, "smith2024").unwrap().is_some(),
            "tombstoned entry must be revived when file mtime changes (gap-fill)");
    }

    #[test]
    fn test_ingest_workspace_bibs_dedup_across_files() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open_memory().unwrap();
        let cache = crate::bib::cache::BibCache::new();

        write_bib_file(dir.path(), "a.bib",
            "@article{entryA,\n  author = {A},\n  title = {T},\n  year = {2024},\n  doi = {10.1000/x}\n}");
        write_bib_file(dir.path(), "b.bib",
            "@article{entryB,\n  author = {B},\n  title = {T},\n  year = {2024},\n  doi = {10.1000/x}\n}");

        let stats = ingest_workspace_bibs(&store.conn, dir.path(), &cache).unwrap();
        assert_eq!(stats.entries_dedup_skipped, 1,
            "one entry should be dedup-skipped due to shared DOI");
        assert_eq!(list_bib_items(&store.conn).unwrap().len(), 1);
    }

    #[test]
    fn test_ingest_workspace_bibs_hidden_dir_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open_memory().unwrap();
        let cache = crate::bib::cache::BibCache::new();

        write_bib_file(dir.path(), ".hidden/refs.bib",
            "@article{smith2024,\n  author = {Smith},\n  title = {Alpha},\n  year = {2024}\n}");
        write_bib_file(dir.path(), "visible.bib",
            "@book{doe2022,\n  author = {Doe},\n  title = {Gamma},\n  year = {2022}\n}");

        let stats = ingest_workspace_bibs(&store.conn, dir.path(), &cache).unwrap();
        assert_eq!(stats.files_scanned, 1);
        assert_eq!(stats.entries_inserted, 1);
        assert!(get_bib_item(&store.conn, "smith2024").unwrap().is_none(),
            ".bib inside hidden dir must not be ingested");
    }
}
