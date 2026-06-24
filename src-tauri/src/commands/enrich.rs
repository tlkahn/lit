use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::bib::convert::{
    crossref_ref_to_bib_entry, csl_to_bib_entry, normalize_doi, strip_jats, CrossrefReference,
    CslItem,
};
use rusqlite::Connection;

use crate::bib::db::{self, UpsertOutcome};
use crate::bib::research_hub::providers_from_app_handle;
use crate::bib::semantic_scholar::{
    lookup_by_doi_with_base as s2_lookup_by_doi_with_base,
    lookup_by_paper_id_with_base, s2_paper_to_bib_entry,
    s2_ref_to_bib_entry, search_by_title_with_base, S2Paper, S2Reference,
};
use crate::bib::types::BibEntry;
use crate::commands::bib_import::{fetch_crossref_csl_item, HTTP_CLIENT};
use crate::recognize::resolve::isbn::{self, IsbnPath};
use crate::recognize::resolve::BaseUrls;
use crate::recognize::resolve::title_match::{is_punctuation, strip_combining_marks};
use crate::commands::graph::GraphRegistry;
use crate::commands::page::lookup_graph_index;

const MAX_REFERENCES: usize = 30;

/// Normalize a string for similarity comparison: lowercase, replace punctuation
/// with spaces (via [`is_punctuation`](crate::recognize::resolve::title_match::is_punctuation)),
/// split into words. Returns an owned `Vec<String>` preserving word order.
fn normalize_words(s: &str) -> Vec<String> {
    let decomposed = strip_combining_marks(s);
    decomposed
        .to_lowercase()
        .chars()
        .map(|c| if is_punctuation(c) { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .map(String::from)
        .collect()
}

/// Compute the ratio of the longest common subsequence (LCS) of words to the
/// longer of the two word sequences. Takes pre-normalized word slices.
/// Returns a value in `[0.0, 1.0]`.
///
/// Two empty slices yield 1.0; one empty and one non-empty yield 0.0.
fn word_lcs_ratio(words_a: &[String], words_b: &[String]) -> f64 {
    let len_a = words_a.len();
    let len_b = words_b.len();

    if len_a == 0 && len_b == 0 {
        return 1.0;
    }
    if len_a == 0 || len_b == 0 {
        return 0.0;
    }

    // Standard DP table for LCS length
    let mut dp = vec![vec![0usize; len_b + 1]; len_a + 1];
    for i in 1..=len_a {
        for j in 1..=len_b {
            if words_a[i - 1] == words_b[j - 1] {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = dp[i - 1][j].max(dp[i][j - 1]);
            }
        }
    }

    let lcs_len = dp[len_a][len_b];
    lcs_len as f64 / len_a.max(len_b) as f64
}

/// Compute title similarity as an equal-weight blend of Jaccard similarity
/// (word-set overlap) and LCS word ratio (longest common subsequence of words,
/// normalized by max length). This penalizes reordered or partially-matching
/// titles compared to pure Jaccard.
///
/// Returns a value in `[0.0, 1.0]`. Two empty strings yield 1.0;
/// one empty and one non-empty yield 0.0.
pub fn title_similarity(a: &str, b: &str) -> f64 {
    let words_a = normalize_words(a);
    let words_b = normalize_words(b);

    let set_a: HashSet<&str> = words_a.iter().map(|w| w.as_str()).collect();
    let set_b: HashSet<&str> = words_b.iter().map(|w| w.as_str()).collect();

    let jaccard = if set_a.is_empty() && set_b.is_empty() {
        1.0
    } else if set_a.is_empty() || set_b.is_empty() {
        0.0
    } else {
        let intersection = set_a.intersection(&set_b).count();
        let union = set_a.union(&set_b).count();
        intersection as f64 / union as f64
    };

    let lcs = word_lcs_ratio(&words_a, &words_b);

    0.5 * jaccard + 0.5 * lcs
}

#[derive(Debug, Clone, Serialize)]
pub struct EnrichResult {
    pub entry: BibEntry,
    pub fields_added: Vec<String>,
    pub references_found: usize,
    pub references_appended: usize,
    pub shadow_nodes_created: usize,
    pub references_linked: usize,
    /// Candidate matches when no auto-merge occurred (best title similarity < 0.85).
    /// Empty when auto-merge succeeded.
    pub candidates: Vec<BibEntry>,
    /// Provider IDs that were successfully queried.
    pub providers_searched: Vec<String>,
    /// Provider IDs that failed during the search.
    pub providers_failed: Vec<String>,
}

/// Mutable counters passed to [`link_ref`] to track bookkeeping across calls.
#[derive(Debug, Default)]
struct LinkCounters {
    references_appended: usize,
    shadow_nodes_created: usize,
    references_linked: usize,
    position: usize,
}

/// Upsert `ref_entry` as a shadow bib item, then link it as a child reference
/// of `parent_key`. Handles key dedup (`DedupSkipped`), position tracking, and
/// counter bookkeeping. Call-site is responsible for source-specific conversion
/// and identity-based skip logic.
fn link_ref(
    conn: &Connection,
    parent_key: &str,
    ref_entry: &BibEntry,
    used_keys: &mut HashSet<String>,
    counters: &mut LinkCounters,
) -> Result<(), String> {
    used_keys.insert(ref_entry.key.clone());

    let outcome = db::upsert_bib_item(conn, ref_entry, None, None, true)
        .map_err(|e| e.to_string())?;
    counters.references_appended += 1;
    if matches!(outcome, UpsertOutcome::Inserted { .. } | UpsertOutcome::Updated { .. }) {
        counters.shadow_nodes_created += 1;
    }

    let child_key = match &outcome {
        UpsertOutcome::DedupSkipped { existing_key } => existing_key.clone(),
        _ => ref_entry.key.clone(),
    };
    let inserted = db::insert_bib_reference(conn, parent_key, &child_key, Some(counters.position as i64))
        .map_err(|e| e.to_string())?;
    if inserted {
        counters.references_linked += 1;
        counters.position += 1;
    }
    Ok(())
}

/// Result of scoring and selecting the best match from search results.
#[derive(Debug)]
pub struct MatchResult {
    /// The best entry when auto-merged (title similarity >= 0.85), or None.
    pub best_entry: Option<BibEntry>,
    /// Candidate entries when no auto-merge occurred (best title similarity < 0.85).
    pub candidates: Vec<BibEntry>,
}

const AUTO_MERGE_THRESHOLD: f64 = 0.85;

/// Score search results against the existing title and select the best match.
///
/// - If the top result has title similarity >= 0.85, it is auto-merged
///   and `candidates` is empty.
/// - Otherwise, all results within 0.05 of the best score are returned
///   as candidates for the user to pick from.
pub fn select_best_match(
    existing_title: &str,
    search_result: &research_hub::SearchResult,
    existing_keys: &HashSet<String>,
) -> MatchResult {
    use crate::bib::research_hub::paper_to_bib_entry;

    if search_result.papers.is_empty() {
        return MatchResult {
            best_entry: None,
            candidates: vec![],
        };
    }

    let mut scored: Vec<(f64, BibEntry)> = search_result
        .papers
        .iter()
        .map(|paper| {
            let entry = paper_to_bib_entry(paper, existing_keys);
            let score = title_similarity(existing_title, &entry.title);
            (score, entry)
        })
        .collect();

    // Sort descending by score
    scored.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let best_score = scored[0].0;

    if best_score >= AUTO_MERGE_THRESHOLD {
        let (_, best_entry) = scored.remove(0);
        MatchResult {
            best_entry: Some(best_entry),
            candidates: vec![],
        }
    } else {
        let threshold = best_score - 0.05;
        let candidates: Vec<BibEntry> = scored
            .into_iter()
            .filter(|(score, _)| *score >= threshold)
            .map(|(_, entry)| entry)
            .collect();
        MatchResult {
            best_entry: None,
            candidates,
        }
    }
}

/// Merge enrichment fields from up to two sources into an existing entry.
/// `crossref` is the preferred source; `s2` fills gaps when CrossRef does not
/// have a value. Only adds fields that are missing (None or empty) on the
/// existing entry. Returns a HashMap of BibTeX field names to raw values.
pub fn merge_enrichment_fields(
    existing: &BibEntry,
    crossref: Option<&BibEntry>,
    s2: Option<&BibEntry>,
) -> HashMap<String, String> {
    let mut result = HashMap::new();

    let enrichable: Vec<(&str, fn(&BibEntry) -> Option<&str>)> = vec![
        ("abstract", |e: &BibEntry| e.abstract_text.as_deref()),
        ("doi", |e: &BibEntry| e.doi.as_deref()),
        ("journal", |e: &BibEntry| e.journal.as_deref()),
        ("url", |e: &BibEntry| e.url.as_deref()),
        ("volume", |e: &BibEntry| e.volume.as_deref()),
        ("number", |e: &BibEntry| e.number.as_deref()),
        ("pages", |e: &BibEntry| e.pages.as_deref()),
        ("publisher", |e: &BibEntry| e.publisher.as_deref()),
        ("issn", |e: &BibEntry| e.issn.as_deref()),
        ("isbn", |e: &BibEntry| e.isbn.as_deref()),
    ];

    for (field_name, getter) in &enrichable {
        let existing_val = getter(existing);
        if existing_val.is_some() && !existing_val.unwrap().is_empty() {
            continue;
        }

        let crossref_val = crossref.and_then(|e| getter(e));
        let s2_val = s2.and_then(|e| getter(e));

        let chosen = crossref_val
            .filter(|v| !v.is_empty())
            .or_else(|| s2_val.filter(|v| !v.is_empty()));

        if let Some(val) = chosen {
            result.insert(field_name.to_string(), val.to_string());
        }
    }

    // Title: always prefer the authoritative enriched title over whatever
    // the sparse stub had (empty, unstructured fallback, etc.).
    let enriched_title = crossref
        .map(|e| e.title.as_str())
        .filter(|t| !t.is_empty())
        .or_else(|| s2.map(|e| e.title.as_str()).filter(|t| !t.is_empty()));

    if let Some(title) = enriched_title {
        if title != existing.title {
            result.insert("title".to_string(), title.to_string());
        }
    }

    result
}

/// Merge enrichment fields from up to two sources and persist any new fields
/// to the DB. Returns `(new_fields, fields_added)` where `fields_added` is
/// empty when the DB row was not actually modified (idempotent update).
fn merge_and_persist(
    conn: &Connection,
    bib_key: &str,
    existing: &BibEntry,
    source_a: Option<&BibEntry>,
    source_b: Option<&BibEntry>,
) -> Result<(HashMap<String, String>, Vec<String>), String> {
    let new_fields = merge_enrichment_fields(existing, source_a, source_b);
    let mut fields_added: Vec<String> = new_fields.keys().cloned().collect();
    if !new_fields.is_empty() {
        let modified = db::update_bib_fields(conn, bib_key, &new_fields)
            .map_err(|e| e.to_string())?;
        if !modified {
            fields_added.clear();
        }
    }
    Ok((new_fields, fields_added))
}

async fn try_isbn_enrichment(
    isbn: &str,
    client: &reqwest::Client,
    open_library_base: &str,
    google_books_base: &str,
) -> Option<(BibEntry, IsbnPath)> {
    match isbn::resolve_isbn_with_base(client, isbn, open_library_base, google_books_base).await {
        Ok(result) => Some(result),
        Err(e) => {
            tracing::debug!(error = %e, "ISBN enrichment resolution failed");
            None
        }
    }
}

async fn fetch_crossref(doi: &str) -> Result<CslItem, String> {
    fetch_crossref_csl_item(doi).await
}

async fn fetch_s2(
    doi: Option<&str>,
    title: &str,
) -> Result<S2Paper, String> {
    fetch_s2_with_base(doi, title, &HTTP_CLIENT, "https://api.semanticscholar.org").await
}

async fn fetch_s2_with_base(
    doi: Option<&str>,
    title: &str,
    client: &reqwest::Client,
    base_url: &str,
) -> Result<S2Paper, String> {
    let title_is_empty = title.trim().is_empty();

    let paper = if let Some(doi) = doi {
        match s2_lookup_by_doi_with_base(client, doi, base_url).await {
            Ok(p) => p,
            Err(doi_err) => {
                if title_is_empty {
                    return Err(format!(
                        "DOI lookup failed ({}) and title is empty; cannot fall back to title search",
                        doi_err
                    ));
                }
                let papers = search_by_title_with_base(client, title, base_url).await?;
                papers
                    .into_iter()
                    .next()
                    .ok_or_else(|| "No results found on Semantic Scholar".to_string())?
            }
        }
    } else {
        if title_is_empty {
            return Err(
                "Cannot search Semantic Scholar: entry has no DOI and no title".to_string(),
            );
        }
        let papers = search_by_title_with_base(client, title, base_url).await?;
        let search_hit = papers
            .into_iter()
            .next()
            .ok_or_else(|| "No results found on Semantic Scholar".to_string())?;

        // The search endpoint does not return references. Follow up with a
        // full paper lookup by paperId to get reference data.
        if let Some(ref paper_id) = search_hit.paper_id {
            lookup_by_paper_id_with_base(client, paper_id, base_url)
                .await
                .unwrap_or(search_hit)
        } else {
            search_hit
        }
    };

    Ok(paper)
}

/// Link references from S2 and CrossRef sources to a parent bib entry.
/// Returns `(references_found, counters)` for the caller to include in
/// `EnrichResult`.
fn link_references_from_sources(
    conn: &Connection,
    parent_key: &str,
    crossref_csl: Option<&CslItem>,
    s2_paper: Option<&S2Paper>,
    precomputed_keys: Option<HashSet<String>>,
) -> Result<(usize, LinkCounters), String> {
    let crossref_refs: &[CrossrefReference] = crossref_csl
        .and_then(|c| c.reference.as_deref())
        .unwrap_or(&[]);
    let s2_refs = s2_paper
        .and_then(|p| p.references.as_deref())
        .unwrap_or(&[]);

    let references_found = count_distinct_references(s2_refs, crossref_refs);
    let mut counters = LinkCounters::default();
    let has_any_refs = !s2_refs.is_empty() || !crossref_refs.is_empty();

    if has_any_refs {
        // Clear stale reference edges so re-enrichment is idempotent
        db::delete_references_for(conn, parent_key)
            .map_err(|e| e.to_string())?;

        let mut used_keys = match precomputed_keys {
            Some(keys) => keys,
            None => db::all_live_keys(conn).map_err(|e| e.to_string())?,
        };

        let mut seen_identities: HashSet<String> = HashSet::new();

        // S2 references first (they take priority)
        for r in s2_refs.iter().take(MAX_REFERENCES) {
            let ref_entry = s2_ref_to_bib_entry(r, &used_keys);
            if let Some(identity) = ref_identity_key(
                ref_entry.doi.as_deref(),
                &ref_entry.title,
                &ref_entry.year,
            ) {
                seen_identities.insert(identity);
            }
            link_ref(conn, parent_key, &ref_entry, &mut used_keys, &mut counters)?;
        }

        // Crossref references: fill gaps, skip duplicates by identity
        let remaining_slots = MAX_REFERENCES.saturating_sub(counters.position);
        for cr in crossref_refs.iter().take(remaining_slots) {
            let cr_doi = cr.doi.as_deref().map(normalize_doi);
            let cr_title = crate::bib::convert::crossref_ref_title(cr);
            let cr_year = cr.year.as_deref().unwrap_or_default();
            if let Some(identity) =
                ref_identity_key(cr_doi.as_deref(), &cr_title, cr_year)
            {
                if !seen_identities.insert(identity) {
                    continue;
                }
            }

            let ref_entry = crossref_ref_to_bib_entry(cr, &used_keys);
            link_ref(conn, parent_key, &ref_entry, &mut used_keys, &mut counters)?;
        }
    }

    Ok((references_found, counters))
}

/// Fetch references from CrossRef and/or Semantic Scholar, then link them to
/// a parent bib entry. When a DOI is available, both sources are fetched
/// concurrently; otherwise only S2 title search is used.
///
/// `precomputed_keys` is forwarded to [`link_references_from_sources`]; pass
/// `None` when the caller has no pre-fetched keys (the helper will fetch them
/// internally).
///
/// Returns `(references_found, counters)`.
async fn fetch_and_link_references(
    enriched_doi: Option<&str>,
    title: &str,
    gi: &Arc<crate::graph::indexer::GraphIndex>,
    bib_key: &str,
    precomputed_keys: Option<HashSet<String>>,
) -> Result<(usize, LinkCounters), String> {
    if let Some(doi) = enriched_doi {
        // DOI available: CrossRef + S2 concurrently
        let crossref_fut = async { fetch_crossref(doi).await.ok() };
        let s2_fut = async { fetch_s2(Some(doi), title).await.ok() };
        let (crossref_csl, s2_paper) = tokio::join!(crossref_fut, s2_fut);

        let store = gi.store();
        link_references_from_sources(
            &store.conn,
            bib_key,
            crossref_csl.as_ref(),
            s2_paper.as_ref(),
            precomputed_keys,
        )
    } else {
        // No DOI: S2 title search only
        let s2_paper = fetch_s2(None, title).await.ok();
        if s2_paper.is_some() {
            let store = gi.store();
            link_references_from_sources(
                &store.conn,
                bib_key,
                None,
                s2_paper.as_ref(),
                precomputed_keys,
            )
        } else {
            Ok((0, LinkCounters::default()))
        }
    }
}

/// Compute a normalized identity key for a reference, used to deduplicate
/// across S2 and Crossref passes. Returns `Some("doi:<normalized>")` when a
/// DOI is present, or `Some("ty:<normalized_title>|<year>")` when both title
/// and year are non-empty, or `None` when neither is available.
fn ref_identity_key(doi: Option<&str>, title: &str, year: &str) -> Option<String> {
    if let Some(d) = doi {
        let normalized = normalize_doi(d).to_lowercase();
        if !normalized.is_empty() {
            return Some(format!("doi:{}", normalized));
        }
    }
    let norm_title = db::normalize_title_for_dedup(title);
    if !norm_title.is_empty() && !year.is_empty() {
        return Some(format!("ty:{}|{}", norm_title, year));
    }
    None
}

/// Count the number of distinct references across S2 and Crossref sources,
/// using identity-key dedup (DOI or normalized title+year). References
/// without an identity key (no DOI and no title+year) are each counted as
/// distinct since we cannot determine overlap.
fn count_distinct_references(
    s2_refs: &[S2Reference],
    crossref_refs: &[CrossrefReference],
) -> usize {
    let mut seen = HashSet::new();
    let mut no_identity = 0usize;

    for r in s2_refs {
        let doi = r
            .external_ids
            .as_ref()
            .and_then(|ids| ids.doi.as_deref())
            .map(normalize_doi);
        let title = r.title.as_deref().unwrap_or_default();
        let year = r.year.map(|y| y.to_string()).unwrap_or_default();
        match ref_identity_key(doi.as_deref(), title, &year) {
            Some(key) => {
                seen.insert(key);
            }
            None => {
                no_identity += 1;
            }
        }
    }

    for cr in crossref_refs {
        let doi = cr.doi.as_deref().map(normalize_doi);
        let title = cr
            .article_title
            .as_deref()
            .map(strip_jats)
            .unwrap_or_default();
        let year = cr.year.as_deref().unwrap_or_default();
        match ref_identity_key(doi.as_deref(), &title, year) {
            Some(key) => {
                seen.insert(key);
            }
            None => {
                no_identity += 1;
            }
        }
    }

    seen.len() + no_identity
}

/// Core enrichment logic, callable outside Tauri command handlers.
///
/// Four code paths:
///
/// **Path A (DOI fast path):** When `existing.doi` is present, use it for
/// authoritative lookup via CrossRef + S2 concurrently. This is more
/// reliable than title matching and handles empty-title entries.
///
/// **Path ISBN:** When no DOI but `existing.isbn` is present, resolve via
/// Open Library / Google Books. Reference linking is skipped (books
/// rarely have DOI-indexed refs). Falls through to Path B on failure.
///
/// **Path B (title search):** When no DOI but the title is non-empty, use
/// `meta_search` to discover metadata across all enabled providers, score
/// results via Jaccard title similarity, and auto-merge strong matches
/// (>= 0.85). When no strong match is found but candidates exist, do
/// best-effort enrichment with the top candidate to avoid silent failure.
///
/// **Path C (no DOI, no title):** Return an error.
///
/// After enrichment, reference linking is performed via CrossRef and
/// Semantic Scholar by DOI when one is available.
///
/// Callers are responsible for issuing `notify_bib_changed` after a
/// successful call.
pub(crate) async fn enrich_entry(
    bib_key: &str,
    gi: &Arc<crate::graph::indexer::GraphIndex>,
    app_handle: &tauri::AppHandle,
) -> Result<EnrichResult, String> {
    let existing = {
        let store = gi.store();
        db::get_bib_item(&store.conn, bib_key)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Entry '{}' not found in workspace", bib_key))?
    };

    // ── Path A: DOI fast path ───────────────────────────────────────
    // When the entry already has a DOI, use it for authoritative lookup
    // via CrossRef + S2 (the pre-meta_search behavior). This is more
    // reliable than title matching and handles empty-title entries.
    if let Some(ref doi) = existing.doi {
        let crossref_fut = async { fetch_crossref(doi).await.ok() };
        let s2_fut = async { fetch_s2(Some(doi), &existing.title).await.ok() };
        let (crossref_csl, s2_paper) = tokio::join!(crossref_fut, s2_fut);

        let crossref_entry = crossref_csl.as_ref().map(csl_to_bib_entry);
        let s2_entry = s2_paper.as_ref().map(|p| s2_paper_to_bib_entry(p, &HashSet::new()));

        // Merge fields from both sources (CrossRef preferred, S2 fills gaps)
        let (_new_fields, fields_added) = {
            let store = gi.store();
            merge_and_persist(&store.conn, bib_key, &existing, crossref_entry.as_ref(), s2_entry.as_ref())?
        };

        // Link references (reuse already-fetched crossref_csl / s2_paper)
        let (references_found, counters) = {
            let store = gi.store();
            link_references_from_sources(
                &store.conn,
                bib_key,
                crossref_csl.as_ref(),
                s2_paper.as_ref(),
                None,
            )?
        };

        // Re-read entry from DB
        let updated_entry = {
            let store = gi.store();
            db::get_bib_item(&store.conn, bib_key)
                .map_err(|e| e.to_string())?
                .unwrap_or(existing)
        };

        // Report which providers succeeded vs failed
        let mut providers_searched = vec![];
        let mut providers_failed = vec![];
        if crossref_csl.is_some() {
            providers_searched.push("crossref".to_string());
        } else {
            providers_failed.push("crossref".to_string());
        }
        if s2_paper.is_some() {
            providers_searched.push("semantic_scholar".to_string());
        } else {
            providers_failed.push("semantic_scholar".to_string());
        }

        return Ok(EnrichResult {
            entry: updated_entry,
            fields_added,
            references_found,
            references_appended: counters.references_appended,
            shadow_nodes_created: counters.shadow_nodes_created,
            references_linked: counters.references_linked,
            candidates: vec![],
            providers_searched,
            providers_failed,
        });
    }

    // ── Path ISBN: ISBN present, no DOI ─────────────────────────────
    if let Some(ref isbn_val) = existing.isbn {
        let urls = BaseUrls::production();
        if let Some((isbn_entry, isbn_path)) = try_isbn_enrichment(
            isbn_val, &HTTP_CLIENT, urls.open_library, urls.google_books,
        ).await {
            let (_new_fields, fields_added) = {
                let store = gi.store();
                merge_and_persist(&store.conn, bib_key, &existing, Some(&isbn_entry), None)?
            };

            let updated_entry = {
                let store = gi.store();
                db::get_bib_item(&store.conn, bib_key)
                    .map_err(|e| e.to_string())?
                    .unwrap_or(existing)
            };

            let providers_failed = if isbn_path == IsbnPath::GoogleBooks {
                vec!["open_library".to_string()]
            } else {
                vec![]
            };

            return Ok(EnrichResult {
                entry: updated_entry,
                fields_added,
                references_found: 0,
                references_appended: 0,
                shadow_nodes_created: 0,
                references_linked: 0,
                candidates: vec![],
                providers_searched: vec![isbn_path.provider_name().to_string()],
                providers_failed,
            });
        }
        // ISBN resolution failed — fall through to title search (Path B)
    }

    // ── Path C: No DOI and no title ─────────────────────────────────
    let title_is_empty = existing.title.trim().is_empty();
    if title_is_empty {
        return Err(
            "Cannot enrich: entry has no DOI, no title, and ISBN lookup failed".to_string(),
        );
    }

    // ── Path B: No DOI, has title -> meta_search ────────────────────
    let (config, providers) = providers_from_app_handle(app_handle, HTTP_CLIENT.clone());

    // Search for the title across all enabled providers
    let search_result = research_hub::meta_search(
        &existing.title,
        &providers,
        &config,
        Some(research_hub::SearchType::Title),
        10, // limit: fetch up to 10 results for scoring
        0,  // offset
        research_hub::SortOrder::Relevance,
    )
    .await;

    let providers_searched = search_result.providers_searched.clone();
    let providers_failed = search_result.providers_failed.clone();

    // Score results against existing title and select best match
    let mut used_keys = {
        let store = gi.store();
        db::all_live_keys(&store.conn).map_err(|e| e.to_string())?
    };
    let match_result = select_best_match(&existing.title, &search_result, &used_keys);

    let mut fields_added: Vec<String> = vec![];
    let mut counters = LinkCounters::default();
    let mut references_found = 0usize;
    let candidates;

    // Determine the entry to merge from: strong match or best-effort fallback
    let merge_entry: Option<&BibEntry>;

    if let Some(ref best_entry) = match_result.best_entry {
        // Strong match (>= 0.85): auto-merge
        merge_entry = Some(best_entry);
        candidates = vec![];
    } else if !match_result.candidates.is_empty() {
        merge_entry = None;
        candidates = match_result.candidates.clone();
    } else {
        merge_entry = None;
        candidates = vec![];
    }

    if let Some(entry_to_merge) = merge_entry {
        let (new_fields, fa) = {
            let store = gi.store();
            merge_and_persist(&store.conn, bib_key, &existing, Some(entry_to_merge), None)?
        };
        fields_added = fa;

        // Reference linking
        let enriched_doi = new_fields
            .get("doi")
            .cloned()
            .or_else(|| existing.doi.clone());

        let (found, link_counters) = fetch_and_link_references(
            enriched_doi.as_deref(),
            &existing.title,
            gi,
            bib_key,
            Some(std::mem::take(&mut used_keys)),
        ).await?;
        references_found = found;
        counters = link_counters;
    }

    // Re-read the entry from DB to get the enriched version
    let updated_entry = {
        let store = gi.store();
        db::get_bib_item(&store.conn, bib_key)
            .map_err(|e| e.to_string())?
            .unwrap_or(existing)
    };

    Ok(EnrichResult {
        entry: updated_entry,
        fields_added,
        references_found,
        references_appended: counters.references_appended,
        shadow_nodes_created: counters.shadow_nodes_created,
        references_linked: counters.references_linked,
        candidates,
        providers_searched,
        providers_failed,
    })
}

#[tauri::command]
pub async fn enrich_bib_entry(
    bib_key: String,
    workspace_path: String,
    graph_state: State<'_, Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<EnrichResult, String> {
    let root = PathBuf::from(&workspace_path);
    let gi = lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;

    let result = enrich_entry(&bib_key, &gi, &app_handle).await?;

    if !result.fields_added.is_empty()
        || result.references_appended > 0
        || result.shadow_nodes_created > 0
    {
        crate::commands::graph::notify_bib_changed(&graph_state, &root, &app_handle);
    }

    Ok(result)
}

#[tauri::command]
pub async fn apply_enrichment_candidate(
    bib_key: String,
    candidate: BibEntry,
    workspace_path: String,
    graph_state: State<'_, Arc<GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<EnrichResult, String> {
    let root = PathBuf::from(&workspace_path);
    let gi = lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;

    let existing = {
        let store = gi.store();
        db::get_bib_item(&store.conn, &bib_key)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Entry '{}' not found in workspace", bib_key))?
    };

    let (new_fields, fields_added) = {
        let store = gi.store();
        merge_and_persist(&store.conn, &bib_key, &existing, Some(&candidate), None)?
    };

    let enriched_doi = new_fields
        .get("doi")
        .cloned()
        .or_else(|| existing.doi.clone());

    let (references_found, counters) = fetch_and_link_references(
        enriched_doi.as_deref(),
        &existing.title,
        &gi,
        &bib_key,
        None,
    ).await?;

    let updated_entry = {
        let store = gi.store();
        db::get_bib_item(&store.conn, &bib_key)
            .map_err(|e| e.to_string())?
            .unwrap_or(existing)
    };

    crate::commands::graph::notify_bib_changed(&graph_state, &root, &app_handle);

    Ok(EnrichResult {
        entry: updated_entry,
        fields_added,
        references_found,
        references_appended: counters.references_appended,
        shadow_nodes_created: counters.shadow_nodes_created,
        references_linked: counters.references_linked,
        candidates: vec![],
        providers_searched: vec![],
        providers_failed: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bib::cache::BibCache;
    use crate::bib::types::BibEntry;
    use crate::bib::writer::{append_entries_to_file, update_entry_fields};
    use std::fs;
    use tempfile::TempDir;

    fn make_entry(overrides: impl FnOnce(&mut BibEntry)) -> BibEntry {
        let mut entry = BibEntry {
            key: "test2024".to_string(),
            authors: vec!["Test, Author".to_string()],
            title: "Test Title".to_string(),
            year: "2024".to_string(),
            entry_type: "article".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: None,
            journal: None,
            url: None,
            file: None,
            volume: None,
            number: None,
            pages: None,
            publisher: None,
            issn: None,
            isbn: None,
            arxiv_id: None,
            oclc: None,
            work_type: None,
            series: None,
            lccn: None,
            editors: vec![],
            tags: vec![],
        };
        overrides(&mut entry);
        entry
    }

    // ── apply_enrichment_candidate core logic ─────────────────────

    #[test]
    fn apply_enrichment_candidate_merges_fields_preserves_existing() {
        use crate::bib::db;
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        let existing = make_entry(|e| {
            e.key = "sparse2024".to_string();
            e.title = "Sparse Paper".to_string();
            e.year = "2024".to_string();
            e.doi = None;
            e.abstract_text = None;
            e.journal = None;
        });
        db::upsert_bib_item(&store.conn, &existing, None, None, false).unwrap();

        let candidate = make_entry(|e| {
            e.title = String::new();
            e.doi = Some("10.1/candidate".to_string());
            e.abstract_text = Some("Candidate abstract".to_string());
            e.journal = Some("Nature".to_string());
        });

        let new_fields = merge_enrichment_fields(&existing, Some(&candidate), None);
        assert!(new_fields.contains_key("doi"));
        assert!(new_fields.contains_key("abstract"));
        assert!(new_fields.contains_key("journal"));

        let updated = db::update_bib_fields(&store.conn, "sparse2024", &new_fields).unwrap();
        assert!(updated);

        let fetched = db::get_bib_item(&store.conn, "sparse2024").unwrap().unwrap();
        assert_eq!(fetched.doi, Some("10.1/candidate".to_string()));
        assert_eq!(fetched.abstract_text, Some("Candidate abstract".to_string()));
        assert_eq!(fetched.journal, Some("Nature".to_string()));
        assert_eq!(fetched.title, "Sparse Paper");
        assert_eq!(fetched.year, "2024");
    }

    // ── title_similarity ─────────────────────────────────────────

    #[test]
    fn title_similarity_exact_match() {
        assert_eq!(
            title_similarity("Attention Is All You Need", "Attention Is All You Need"),
            1.0,
        );
    }

    #[test]
    fn title_similarity_case_insensitive() {
        assert_eq!(title_similarity("HELLO WORLD", "hello world"), 1.0);
    }

    #[test]
    fn title_similarity_subtitle_variation() {
        let score = title_similarity(
            "Attention Is All You Need",
            "Attention Is All You Need: A Transformer Architecture",
        );
        // Jaccard = 5/8 = 0.625, LCS ratio = 5/8 = 0.625, combined = 0.625
        assert!(
            score > 0.5 && score < 1.0,
            "subtitle variation should be high but not 1.0, got {}",
            score,
        );
    }

    #[test]
    fn title_similarity_punctuation_diffs() {
        assert_eq!(
            title_similarity("Hello, World! A Study", "Hello World A Study"),
            1.0,
        );
    }

    #[test]
    fn title_similarity_unicode_dash() {
        // em-dash should be stripped as punctuation
        assert_eq!(
            title_similarity("Title \u{2014} Subtitle", "Title Subtitle"),
            1.0,
        );
    }

    #[test]
    fn title_similarity_completely_different() {
        assert_eq!(
            title_similarity("quantum computing advances", "organic chemistry basics"),
            0.0,
        );
    }

    #[test]
    fn title_similarity_empty_strings() {
        assert_eq!(title_similarity("", ""), 1.0);
        assert_eq!(title_similarity("", "hello"), 0.0);
        assert_eq!(title_similarity("hello", ""), 0.0);
    }

    #[test]
    fn title_similarity_lcs_penalizes_reordering() {
        let score = title_similarity("A B C D", "D C B A");
        // Jaccard alone would give 1.0 (identical word sets), but LCS
        // penalizes the total reordering. LCS of [a,b,c,d] vs [d,c,b,a]
        // is 1 (every pair is reversed). ratio = 1/4 = 0.25.
        // Combined: 0.5 * 1.0 + 0.5 * 0.25 = 0.625
        assert!(
            (score - 0.625).abs() < 1e-9,
            "reversed word order should be penalized, got {}",
            score,
        );
    }

    #[test]
    fn title_similarity_generic_title_discrimination() {
        let query = "Decentralized Collaborative Knowledge Management using Git";
        let close = title_similarity(
            query,
            "Decentralized Knowledge Management using Git and Blockchain",
        );
        let generic = title_similarity(query, "Knowledge Management in Practice");
        assert!(
            close > generic,
            "specific title overlap ({close}) should score higher than generic overlap ({generic})",
        );
        assert!(close > 0.6, "close match should score above 0.6, got {close}");
        assert!(
            generic < 0.4,
            "generic overlap should score below 0.4, got {generic}",
        );
    }

    // ── select_best_match ──────────────────────────────────────────

    fn make_search_result_for_matching(
        papers: Vec<research_hub::Paper>,
    ) -> research_hub::SearchResult {
        let total_results = papers.len();
        research_hub::SearchResult {
            query: "test".to_string(),
            search_type: "TITLE".to_string(),
            papers,
            total_results,
            offset: 0,
            sort: "relevance".to_string(),
            total_hits: None,
            provider_hits: vec![],
            providers_searched: vec!["openalex".to_string()],
            providers_failed: vec![],
        }
    }

    fn make_paper_with_title(title: &str) -> research_hub::Paper {
        research_hub::Paper {
            title: title.to_string(),
            authors: vec!["Author, A".to_string()],
            year: Some(2024),
            source: "openalex".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn select_best_match_strong_match_auto_merges() {
        // Title with >= 0.85 similarity should auto-merge
        let sr = make_search_result_for_matching(vec![
            make_paper_with_title("Attention Is All You Need"),
        ]);
        let keys = HashSet::new();
        let result = select_best_match("Attention Is All You Need", &sr, &keys);
        assert!(result.best_entry.is_some(), "should auto-merge exact match");
        assert!(result.candidates.is_empty(), "candidates should be empty on auto-merge");
    }

    #[test]
    fn select_best_match_weak_match_returns_candidates() {
        // Completely different title -> candidate, not auto-merge
        let sr = make_search_result_for_matching(vec![
            make_paper_with_title("Quantum Computing Fundamentals"),
        ]);
        let keys = HashSet::new();
        let result = select_best_match("Attention Is All You Need", &sr, &keys);
        assert!(result.best_entry.is_none(), "should not auto-merge weak match");
        assert!(!result.candidates.is_empty(), "should return candidates");
    }

    #[test]
    fn select_best_match_empty_results() {
        let sr = make_search_result_for_matching(vec![]);
        let keys = HashSet::new();
        let result = select_best_match("Anything", &sr, &keys);
        assert!(result.best_entry.is_none());
        assert!(result.candidates.is_empty());
    }

    #[test]
    fn select_best_match_multiple_close_matches_all_returned() {
        // Two similarly weak matches should both appear as candidates
        let sr = make_search_result_for_matching(vec![
            make_paper_with_title("Machine Learning Survey A"),
            make_paper_with_title("Machine Learning Survey B"),
        ]);
        let keys = HashSet::new();
        let result = select_best_match("Machine Learning Survey", &sr, &keys);
        // Both titles have combined title similarity of 0.75 to query
        // (Jaccard 3/4, LCS ratio 3/4) but neither >= 0.85, so candidates
        assert!(result.best_entry.is_none());
        assert_eq!(result.candidates.len(), 2, "both close matches should be candidates");
    }

    #[test]
    fn select_best_match_strong_with_close_second_still_auto_merges() {
        // Best is exact match (1.0), second is close but should not prevent auto-merge
        let sr = make_search_result_for_matching(vec![
            make_paper_with_title("Attention Is All You Need"),
            make_paper_with_title("Attention Is All You Need: Extended"),
        ]);
        let keys = HashSet::new();
        let result = select_best_match("Attention Is All You Need", &sr, &keys);
        assert!(result.best_entry.is_some(), "should auto-merge best match even with close second");
        assert!(result.candidates.is_empty());
    }

    #[test]
    fn select_best_match_exactly_at_threshold() {
        // Combined title similarity: Jaccard = 6/7, LCS ratio = 6/7
        // (words in order match), combined = 6/7 ~= 0.857 >= 0.85
        let sr = make_search_result_for_matching(vec![
            make_paper_with_title("a b c d e f g"),
        ]);
        let keys = HashSet::new();
        let result = select_best_match("a b c d e f", &sr, &keys);
        assert!(result.best_entry.is_some(), "0.857 >= 0.85 should auto-merge");
    }

    #[test]
    fn select_best_match_just_below_threshold() {
        // Combined: Jaccard = 5/9 ~= 0.556, LCS ratio = 5/7 ~= 0.714,
        // combined ~= 0.635 < 0.85
        let sr = make_search_result_for_matching(vec![
            make_paper_with_title("a b c d e x y"),
        ]);
        let keys = HashSet::new();
        let result = select_best_match("a b c d e f g", &sr, &keys);
        assert!(result.best_entry.is_none(), "0.714 < 0.85 should not auto-merge");
        assert_eq!(result.candidates.len(), 1);
    }

    // ── merge_enrichment_fields ────────────────────────────────────

    #[test]
    fn merge_single_source_fills_missing_fields() {
        let existing = make_entry(|_| {});

        let source = make_entry(|e| {
            e.abstract_text = Some("Source abstract".to_string());
            e.doi = Some("10.1/source".to_string());
            e.url = Some("https://example.com".to_string());
        });

        let merged = merge_enrichment_fields(&existing, Some(&source), None);
        assert_eq!(merged.get("abstract").unwrap(), "Source abstract");
        assert_eq!(merged.get("doi").unwrap(), "10.1/source");
        assert_eq!(merged.get("url").unwrap(), "https://example.com");
    }

    #[test]
    fn merge_skips_existing_fields() {
        let existing = make_entry(|e| {
            e.doi = Some("10.1/existing".to_string());
        });

        let source = make_entry(|e| {
            e.doi = Some("10.1/source".to_string());
        });

        let merged = merge_enrichment_fields(&existing, Some(&source), None);
        assert!(!merged.contains_key("doi"));
    }

    #[test]
    fn merge_source_provides_abstract() {
        let existing = make_entry(|_| {});

        let source = make_entry(|e| {
            e.abstract_text = Some("Source abstract".to_string());
        });

        let merged = merge_enrichment_fields(&existing, Some(&source), None);
        assert_eq!(merged.get("abstract").unwrap(), "Source abstract");
    }

    #[test]
    fn merge_none_source_returns_empty() {
        let existing = make_entry(|_| {});
        let merged = merge_enrichment_fields(&existing, None, None);
        assert!(merged.is_empty());
    }

    #[test]
    fn merge_field_name_mapping() {
        let existing = make_entry(|_| {});

        let crossref = make_entry(|e| {
            e.title = "Enriched Title".to_string();
            e.abstract_text = Some("abs".to_string());
            e.doi = Some("10.1/x".to_string());
            e.journal = Some("Nature".to_string());
            e.url = Some("https://example.com".to_string());
            e.volume = Some("42".to_string());
            e.number = Some("3".to_string());
            e.pages = Some("100--115".to_string());
            e.publisher = Some("Elsevier".to_string());
            e.issn = Some("1234-5678".to_string());
            e.isbn = Some("978-0-123456-78-9".to_string());
        });

        let merged = merge_enrichment_fields(&existing, Some(&crossref), None);
        assert!(merged.contains_key("title"));
        assert!(merged.contains_key("abstract"));
        assert!(merged.contains_key("doi"));
        assert!(merged.contains_key("journal"));
        assert!(merged.contains_key("url"));
        assert!(merged.contains_key("volume"));
        assert!(merged.contains_key("number"));
        assert!(merged.contains_key("pages"));
        assert!(merged.contains_key("publisher"));
        assert!(merged.contains_key("issn"));
        assert!(merged.contains_key("isbn"));
        assert_eq!(merged.len(), 11);
    }

    #[test]
    fn merge_includes_volume_number_pages_publisher_issn() {
        let existing = make_entry(|_| {});

        let crossref = make_entry(|e| {
            e.volume = Some("10".to_string());
            e.number = Some("2".to_string());
            e.pages = Some("50--75".to_string());
            e.publisher = Some("Springer".to_string());
            e.issn = Some("0028-0836".to_string());
        });

        let merged = merge_enrichment_fields(&existing, Some(&crossref), None);
        assert_eq!(merged.get("volume").unwrap(), "10");
        assert_eq!(merged.get("number").unwrap(), "2");
        assert_eq!(merged.get("pages").unwrap(), "50--75");
        assert_eq!(merged.get("publisher").unwrap(), "Springer");
        assert_eq!(merged.get("issn").unwrap(), "0028-0836");
    }

    #[test]
    fn merge_journal_for_inproceedings() {
        let existing = make_entry(|e| {
            e.entry_type = "inproceedings".to_string();
        });

        let source = make_entry(|e| {
            e.journal = Some("Conference 2024".to_string());
        });

        let merged = merge_enrichment_fields(&existing, Some(&source), None);
        assert_eq!(merged.get("journal").unwrap(), "Conference 2024");
    }

    #[test]
    fn merge_skips_empty_string_values_from_source() {
        let existing = make_entry(|_| {});

        let source = make_entry(|e| {
            e.doi = Some("".to_string());
        });

        let merged = merge_enrichment_fields(&existing, Some(&source), None);
        assert!(!merged.contains_key("doi"), "empty string should not be merged");
    }

    // ── merge_enrichment_fields: title ───────────────────────────────

    #[test]
    fn merge_title_overwrites_unstructured_fallback() {
        let existing = make_entry(|e| {
            e.title = "Creighton J D D, Mann R B, Phys. Rev. D 52, 4569 (1995)".to_string();
        });

        let crossref = make_entry(|e| {
            e.title = "Quasilocal thermodynamics".to_string();
        });

        let merged = merge_enrichment_fields(&existing, Some(&crossref), None);
        assert_eq!(merged.get("title").unwrap(), "Quasilocal thermodynamics");
    }

    #[test]
    fn merge_title_fills_empty() {
        let existing = make_entry(|e| {
            e.title = String::new();
        });

        let source = make_entry(|e| {
            e.title = "Real Title".to_string();
        });

        let merged = merge_enrichment_fields(&existing, Some(&source), None);
        assert_eq!(merged.get("title").unwrap(), "Real Title");
    }

    #[test]
    fn merge_title_skips_when_source_title_empty() {
        let existing = make_entry(|e| {
            e.title = "Keep Me".to_string();
        });

        let source = make_entry(|e| {
            e.title = String::new();
        });

        let merged = merge_enrichment_fields(&existing, Some(&source), None);
        assert!(!merged.contains_key("title"));
    }

    // ── merge_enrichment_fields: ISBN ─────────────────────────────────

    #[test]
    fn merge_isbn_from_primary_source() {
        let existing = make_entry(|_| {});
        let primary = make_entry(|e| {
            e.isbn = Some("978-0-123".to_string());
        });
        let merged = merge_enrichment_fields(&existing, Some(&primary), None);
        assert_eq!(merged.get("isbn").unwrap(), "978-0-123");
    }

    #[test]
    fn merge_isbn_from_secondary_when_primary_missing() {
        let existing = make_entry(|_| {});
        let primary = make_entry(|_| {});
        let secondary = make_entry(|e| {
            e.isbn = Some("978-0-456".to_string());
        });
        let merged = merge_enrichment_fields(&existing, Some(&primary), Some(&secondary));
        assert_eq!(merged.get("isbn").unwrap(), "978-0-456");
    }

    #[test]
    fn merge_preserves_existing_isbn() {
        let existing = make_entry(|e| {
            e.isbn = Some("978-0-existing".to_string());
        });
        let primary = make_entry(|e| {
            e.isbn = Some("978-0-new".to_string());
        });
        let merged = merge_enrichment_fields(&existing, Some(&primary), None);
        assert!(!merged.contains_key("isbn"), "existing isbn should not be overwritten");
    }

    // ── try_isbn_enrichment ─────────────────────────────────────────

    #[tokio::test]
    async fn isbn_enrichment_returns_resolved_entry() {
        let mock_server = wiremock::MockServer::start().await;

        let ol_body = r#"{"ISBN:9780306406157":{"title":"A Great Book","publishers":[{"name":"Dover"}],"authors":[{"name":"J. Author"}],"publish_date":"2001"}}"#;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/api/books"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_string(ol_body))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let result = try_isbn_enrichment(
            "9780306406157", &client, &mock_server.uri(), "http://unused.invalid",
        ).await;

        assert!(result.is_some(), "expected Some from Open Library");
        let (entry, isbn_path) = result.unwrap();
        assert_eq!(isbn_path, IsbnPath::OpenLibrary);
        assert_eq!(entry.title, "A Great Book");
        assert_eq!(entry.publisher.as_deref(), Some("Dover"));
    }

    #[tokio::test]
    async fn isbn_enrichment_returns_none_on_both_miss() {
        let ol_server = wiremock::MockServer::start().await;
        let gb_server = wiremock::MockServer::start().await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(wiremock::ResponseTemplate::new(404))
            .mount(&ol_server)
            .await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(wiremock::ResponseTemplate::new(404))
            .mount(&gb_server)
            .await;

        let client = reqwest::Client::new();
        let result = try_isbn_enrichment(
            "9780306406157", &client, &ol_server.uri(), &gb_server.uri(),
        ).await;

        assert!(result.is_none(), "expected None when both providers miss");
    }

    #[tokio::test]
    async fn isbn_enrichment_open_library_fails_falls_through_to_google() {
        let ol_server = wiremock::MockServer::start().await;
        let gb_server = wiremock::MockServer::start().await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(wiremock::ResponseTemplate::new(500))
            .mount(&ol_server)
            .await;

        let gb_body = r#"{"totalItems":1,"items":[{"volumeInfo":{"title":"Google Book Title","authors":["G. Writer"],"publisher":"GB Press","publishedDate":"2005","industryIdentifiers":[{"type":"ISBN_13","identifier":"9780306406157"}]}}]}"#;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_string(gb_body))
            .mount(&gb_server)
            .await;

        let client = reqwest::Client::new();
        let result = try_isbn_enrichment(
            "9780306406157", &client, &ol_server.uri(), &gb_server.uri(),
        ).await;

        assert!(result.is_some(), "expected Some from Google Books fallback");
        let (entry, isbn_path) = result.unwrap();
        assert_eq!(isbn_path, IsbnPath::GoogleBooks);
        assert_eq!(entry.title, "Google Book Title");
    }

    // ── fetch_crossref rejects invalid DOIs ─────────────────────────

    #[tokio::test]
    async fn fetch_crossref_rejects_invalid_doi() {
        let result = fetch_crossref("not-a-doi").await;
        assert!(result.is_err());
        assert!(
            result.as_ref().unwrap_err().contains("Invalid DOI format"),
            "Expected 'Invalid DOI format' but got: {}",
            result.unwrap_err()
        );
    }

    #[tokio::test]
    async fn fetch_crossref_rejects_garbage_doi_with_spaces() {
        let result = fetch_crossref("see paper above").await;
        assert!(result.is_err());
        assert!(
            result.as_ref().unwrap_err().contains("Invalid DOI format"),
            "Expected 'Invalid DOI format' but got: {}",
            result.unwrap_err()
        );
    }

    #[tokio::test]
    async fn fetch_crossref_rejects_url_only_doi() {
        let result = fetch_crossref("https://doi.org/").await;
        assert!(result.is_err());
        assert!(
            result.as_ref().unwrap_err().contains("Invalid DOI format"),
            "Expected 'Invalid DOI format' but got: {}",
            result.unwrap_err()
        );
    }

    // ── fetch_s2 empty-title guard ──────────────────────────────────

    #[tokio::test]
    async fn fetch_s2_rejects_empty_title_no_doi() {
        let client = reqwest::Client::new();
        let result = fetch_s2_with_base(None, "", &client, "http://unused.invalid").await;
        assert!(result.is_err(), "expected Err for empty title + no DOI");
        let err = result.unwrap_err();
        assert!(
            err.contains("no DOI") && err.contains("no title"),
            "expected error mentioning 'no DOI' and 'no title', got: {}",
            err
        );
    }

    #[tokio::test]
    async fn fetch_s2_rejects_whitespace_title_no_doi() {
        let client = reqwest::Client::new();
        let result = fetch_s2_with_base(None, "   \t  ", &client, "http://unused.invalid").await;
        assert!(result.is_err(), "expected Err for whitespace-only title + no DOI");
        let err = result.unwrap_err();
        assert!(
            err.contains("no DOI") && err.contains("no title"),
            "expected error mentioning 'no DOI' and 'no title', got: {}",
            err
        );
    }

    #[tokio::test]
    async fn fetch_s2_rejects_empty_title_after_doi_failure() {
        let mock_server = wiremock::MockServer::start().await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path_regex(r"/graph/v1/paper/DOI:.*"))
            .respond_with(wiremock::ResponseTemplate::new(404))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let result =
            fetch_s2_with_base(Some("10.9999/nonexistent"), "", &client, &mock_server.uri()).await;
        assert!(result.is_err(), "expected Err when DOI fails and title is empty");
        let err = result.unwrap_err();
        assert!(
            err.contains("DOI lookup failed") && err.contains("title is empty"),
            "expected error mentioning 'DOI lookup failed' and 'title is empty', got: {}",
            err
        );
    }

    #[tokio::test]
    async fn fetch_s2_allows_nonempty_title_no_doi() {
        let mock_server = wiremock::MockServer::start().await;
        let body = r#"{
            "total": 1,
            "offset": 0,
            "data": [{
                "paperId": "abc",
                "title": "Quantum Computing Advances",
                "year": 2023,
                "externalIds": {"DOI": "10.1234/qc2023", "CorpusId": 42}
            }]
        }"#;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/graph/v1/paper/search"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_string(body))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let result =
            fetch_s2_with_base(None, "quantum computing", &client, &mock_server.uri()).await;
        assert!(result.is_ok(), "expected Ok for nonempty title, got: {:?}", result);
        let paper = result.unwrap();
        assert_eq!(paper.title.as_deref(), Some("Quantum Computing Advances"));
    }

    // ── fetch_s2 no-DOI path: follow-up paperId lookup for refs ───

    #[tokio::test]
    async fn fetch_s2_no_doi_follows_up_with_paper_id_lookup() {
        let mock_server = wiremock::MockServer::start().await;

        // Step 1: title search returns a paper with paperId but no references
        let search_body = r#"{
            "total": 1,
            "offset": 0,
            "data": [{
                "paperId": "s2paper42",
                "title": "Book Without DOI",
                "year": 2022,
                "externalIds": {"CorpusId": 999}
            }]
        }"#;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/graph/v1/paper/search"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_string(search_body))
            .mount(&mock_server)
            .await;

        // Step 2: paperId lookup returns the full paper with references
        let paper_body = r#"{
            "paperId": "s2paper42",
            "title": "Book Without DOI",
            "year": 2022,
            "externalIds": {"CorpusId": 999},
            "references": [
                {
                    "paperId": "ref1",
                    "title": "Referenced Paper A",
                    "year": 2020,
                    "authors": [{"authorId": "a1", "name": "R. Author"}]
                },
                {
                    "paperId": "ref2",
                    "title": "Referenced Paper B",
                    "year": 2019,
                    "authors": [{"authorId": "a2", "name": "S. Writer"}]
                }
            ]
        }"#;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/graph/v1/paper/s2paper42"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_string(paper_body))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let result =
            fetch_s2_with_base(None, "Book Without DOI", &client, &mock_server.uri()).await;
        assert!(result.is_ok(), "expected Ok, got: {:?}", result);

        let paper = result.unwrap();
        // The follow-up lookup should have returned references
        let refs = paper.references.as_ref().expect("references should be present from paperId lookup");
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].title.as_deref(), Some("Referenced Paper A"));
        assert_eq!(refs[1].title.as_deref(), Some("Referenced Paper B"));
    }

    #[tokio::test]
    async fn fetch_s2_no_doi_paper_id_lookup_fails_falls_back_to_search_hit() {
        let mock_server = wiremock::MockServer::start().await;

        // Title search returns a paper with paperId
        let search_body = r#"{
            "total": 1,
            "offset": 0,
            "data": [{
                "paperId": "s2paper99",
                "title": "Fallback Paper",
                "year": 2021,
                "externalIds": {"CorpusId": 888}
            }]
        }"#;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/graph/v1/paper/search"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_string(search_body))
            .mount(&mock_server)
            .await;

        // paperId lookup fails with 500
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/graph/v1/paper/s2paper99"))
            .respond_with(wiremock::ResponseTemplate::new(500))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let result =
            fetch_s2_with_base(None, "Fallback Paper", &client, &mock_server.uri()).await;
        assert!(result.is_ok(), "should fall back to search hit, got: {:?}", result);

        let paper = result.unwrap();
        // Should still have the search hit data, just no references
        assert_eq!(paper.title.as_deref(), Some("Fallback Paper"));
        assert!(paper.references.is_none(), "search hit should have no references");
    }

    #[tokio::test]
    async fn fetch_s2_no_doi_search_hit_without_paper_id_skips_followup() {
        let mock_server = wiremock::MockServer::start().await;

        // Title search returns a paper without paperId
        let search_body = r#"{
            "total": 1,
            "offset": 0,
            "data": [{
                "title": "No PaperId Paper",
                "year": 2020,
                "externalIds": {"CorpusId": 777}
            }]
        }"#;
        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/graph/v1/paper/search"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_string(search_body))
            .mount(&mock_server)
            .await;

        let client = reqwest::Client::new();
        let result =
            fetch_s2_with_base(None, "No PaperId Paper", &client, &mock_server.uri()).await;
        assert!(result.is_ok(), "should succeed with search hit, got: {:?}", result);

        let paper = result.unwrap();
        assert_eq!(paper.title.as_deref(), Some("No PaperId Paper"));
        assert!(paper.references.is_none(), "no paperId means no follow-up lookup");
    }

    // ── merge_receives_crossref fields via parse_crossref_body ────

    #[test]
    fn merge_receives_crossref_volume_issue_page_publisher_issn() {
        use crate::commands::bib_import::parse_crossref_body;

        let body = r#"{
            "status": "ok",
            "message-type": "work",
            "message": {
                "type": "journal-article",
                "title": ["A Paper"],
                "author": [{"family": "Smith", "given": "John"}],
                "container-title": ["Nature"],
                "issued": {"date-parts": [[2023]]},
                "DOI": "10.1038/test123",
                "volume": "600",
                "issue": "7890",
                "page": "100-110",
                "publisher": "Nature Publishing Group",
                "ISSN": ["0028-0836", "1476-4687"]
            }
        }"#;
        let crossref_entry = parse_crossref_body(body).unwrap();
        let existing = make_entry(|_| {});

        let merged = merge_enrichment_fields(&existing, Some(&crossref_entry), None);
        assert_eq!(merged.get("volume").unwrap(), "600");
        assert_eq!(merged.get("number").unwrap(), "7890");
        assert_eq!(merged.get("pages").unwrap(), "100-110");
        assert_eq!(merged.get("publisher").unwrap(), "Nature Publishing Group");
        assert_eq!(merged.get("issn").unwrap(), "0028-0836");
    }

    // ── refresh_shadows via cloned Arc ──────────────────────────────

    #[test]
    fn refresh_shadows_propagates_through_cloned_arc() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();

        // Create a .md file citing [@smith2024] but no .bib yet
        fs::create_dir_all(dir.path()).unwrap();
        fs::write(dir.path().join("a.md"), "As shown in [@smith2024].").unwrap();

        let gi = crate::graph::indexer::GraphIndex::build(root.clone(), false).unwrap();

        // No shadow initially
        {
            let meta = gi.store().all_nodes_metadata().unwrap();
            assert!(
                !meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
                "shadow should not exist before .bib is written"
            );
        }

        // Insert into a registry (same type as GraphRegistry)
        let registry = GraphRegistry::new();
        registry.indices.lock().unwrap().insert(root.clone(), Arc::new(gi));

        // Write a .bib file
        fs::write(
            dir.path().join("refs.bib"),
            "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}",
        )
        .unwrap();

        // Clone the Arc out and drop the registry guard, then call refresh_shadows
        let gi = graph_state_indices_cloned(&registry, &root);
        assert!(gi.is_some(), "GraphIndex should be in the registry");
        let gi = gi.unwrap();
        let changed = gi.refresh_shadows().unwrap();
        assert!(changed, "refresh_shadows should detect the new .bib entry");

        // Shadow node should now exist
        {
            let meta = gi.store().all_nodes_metadata().unwrap();
            assert!(
                meta.iter().any(|(id, _, _)| id == "bib:smith2024"),
                "shadow must be created after refresh, nodes: {:?}",
                meta
            );
        }
    }

    /// Mirrors the clone-and-drop pattern used in the production code.
    fn graph_state_indices_cloned(
        registry: &GraphRegistry,
        root: &std::path::Path,
    ) -> Option<Arc<crate::graph::indexer::GraphIndex>> {
        registry.indices.lock().unwrap().get(root).cloned()
    }

    // ── EnrichResult serialization ───────────────────────────────────

    #[test]
    fn enrich_result_serializes_references_appended() {
        let result = EnrichResult {
            entry: make_entry(|_| {}),
            fields_added: vec!["abstract".to_string()],
            references_found: 50,
            references_appended: 10,
            shadow_nodes_created: 8,
            references_linked: 10,
            candidates: vec![],
            providers_searched: vec!["openalex".to_string()],
            providers_failed: vec![],
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["references_appended"], 10);
        assert_eq!(json["references_found"], 50);
        assert_eq!(json["shadow_nodes_created"], 8);
        assert_eq!(json["references_linked"], 10);
        assert_eq!(json["providers_searched"], serde_json::json!(["openalex"]));
        assert!(json["candidates"].as_array().unwrap().is_empty());
    }

    // ── references_appended capping contract ──────────────────────

    #[test]
    fn references_appended_capped_at_max_references() {
        let large: Vec<i32> = (0..50).collect();
        assert_eq!(large.iter().take(MAX_REFERENCES).count(), 30);

        let small: Vec<i32> = (0..10).collect();
        assert_eq!(small.iter().take(MAX_REFERENCES).count(), 10);
    }

    // ── full enrichment pipeline (pure functions + file ops) ───────

    #[test]
    fn enrichment_pipeline_with_tempdir() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  author = {Smith, John},\n  title = {Test Paper},\n  year = {2024},\n  doi = {10.1/existing}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        // Simulate enrichment source
        let source = make_entry(|e| {
            e.abstract_text = Some("Enriched abstract".to_string());
            e.url = Some("https://enriched.example.com".to_string());
            e.journal = Some("Nature".to_string());
        });

        let new_fields = merge_enrichment_fields(
            &make_entry(|e| {
                e.doi = Some("10.1/existing".to_string());
            }),
            Some(&source),
            None,
        );

        assert!(new_fields.contains_key("abstract"));
        assert!(new_fields.contains_key("url"));
        assert!(new_fields.contains_key("journal"));

        // Write back
        let modified = update_entry_fields(&bib_path, "smith2024", &new_fields, &cache).unwrap();
        assert!(modified);

        // Verify fields were written
        let updated_content = fs::read_to_string(&bib_path).unwrap();
        let parsed = crate::bib::parser::parse_bibtex(&updated_content);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].abstract_text, Some("Enriched abstract".to_string()));
        assert_eq!(parsed[0].url, Some("https://enriched.example.com".to_string()));
        assert_eq!(parsed[0].journal, Some("Nature".to_string()));
        // Existing doi should be untouched
        assert_eq!(parsed[0].doi, Some("10.1/existing".to_string()));

        // Append reference entries
        let ref_entries = vec![
            make_entry(|e| {
                e.key = "ref1".to_string();
                e.title = "Reference Paper 1".to_string();
                e.doi = Some("10.1/ref1".to_string());
            }),
            make_entry(|e| {
                e.key = "ref2".to_string();
                e.title = "Reference Paper 2".to_string();
                e.doi = None;
            }),
        ];

        let outcomes = append_entries_to_file(&ref_entries, &bib_path, dir.path(), &cache).unwrap();
        assert_eq!(outcomes.len(), 2);

        let final_content = fs::read_to_string(&bib_path).unwrap();
        let final_parsed = crate::bib::parser::parse_bibtex(&final_content);
        assert_eq!(final_parsed.len(), 3);
    }

    // ── idempotent update should report no fields added ────────────

    #[test]
    fn update_noop_fields_added_empty_in_pipeline() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024},\n  doi = {10.1/x},\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let existing = make_entry(|e| {
            e.doi = None; // simulate stale parse missing the doi
        });
        let source = make_entry(|e| {
            e.doi = Some("10.1/x".to_string());
        });

        let new_fields = merge_enrichment_fields(&existing, Some(&source), None);
        assert!(!new_fields.is_empty(), "merge should propose doi");

        let mut fields_added: Vec<String> = new_fields.keys().cloned().collect();
        assert!(!fields_added.is_empty(), "fields_added should be non-empty before write");

        let modified = update_entry_fields(&bib_path, "smith2024", &new_fields, &cache).unwrap();
        assert!(!modified, "update_entry_fields should return false for idempotent write");

        if !modified {
            fields_added.clear();
        }

        assert!(fields_added.is_empty(), "fields_added should be empty when update was a no-op");
    }

    #[test]
    fn update_modified_fields_added_nonempty_in_pipeline() {
        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let content = "@article{smith2024,\n  author = {Smith, John},\n  title = {Alpha},\n  year = {2024}\n}\n";
        fs::write(&bib_path, content).unwrap();
        let cache = BibCache::new();

        let existing = make_entry(|e| {
            e.doi = None;
        });
        let source = make_entry(|e| {
            e.doi = Some("10.1/x".to_string());
        });

        let new_fields = merge_enrichment_fields(&existing, Some(&source), None);
        assert!(!new_fields.is_empty(), "merge should propose doi");

        let mut fields_added: Vec<String> = new_fields.keys().cloned().collect();
        assert!(!fields_added.is_empty());

        let modified = update_entry_fields(&bib_path, "smith2024", &new_fields, &cache).unwrap();
        assert!(modified, "update_entry_fields should return true when fields are actually added");

        if !modified {
            fields_added.clear();
        }

        assert!(!fields_added.is_empty(), "fields_added should still contain the added field");
        assert!(fields_added.contains(&"doi".to_string()));
    }

    // ── DB enrichment pipeline tests ─────────────────────────────

    #[test]
    fn enrichment_pipeline_with_db() {
        use crate::bib::db;
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();
        let existing = make_entry(|e| {
            e.key = "smith2024".to_string();
            e.doi = Some("10.1/existing".to_string());
        });
        db::upsert_bib_item(&store.conn, &existing, None, None, false).unwrap();

        // Simulate enrichment source
        let source = make_entry(|e| {
            e.abstract_text = Some("Enriched abstract".to_string());
            e.url = Some("https://enriched.example.com".to_string());
            e.journal = Some("Nature".to_string());
        });

        let new_fields = merge_enrichment_fields(&existing, Some(&source), None);
        assert!(new_fields.contains_key("abstract"));
        assert!(new_fields.contains_key("url"));
        assert!(new_fields.contains_key("journal"));

        // Apply enrichment fields via DB
        let updated = db::update_bib_fields(&store.conn, "smith2024", &new_fields).unwrap();
        assert!(updated);

        let fetched = db::get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.abstract_text, Some("Enriched abstract".to_string()));
        assert_eq!(fetched.url, Some("https://enriched.example.com".to_string()));
        assert_eq!(fetched.journal, Some("Nature".to_string()));
        // Existing doi should be untouched
        assert_eq!(fetched.doi, Some("10.1/existing".to_string()));

        // Append reference entries via DB
        let ref_entries = vec![
            make_entry(|e| {
                e.key = "ref1".to_string();
                e.title = "Reference Paper 1".to_string();
                e.doi = Some("10.1/ref1".to_string());
            }),
            make_entry(|e| {
                e.key = "ref2".to_string();
                e.title = "Reference Paper 2".to_string();
            }),
        ];

        let mut shadow_count = 0usize;
        for ref_entry in &ref_entries {
            let outcome = db::upsert_bib_item(&store.conn, ref_entry, None, None, true).unwrap();
            if matches!(outcome, db::UpsertOutcome::Inserted { .. } | db::UpsertOutcome::Updated { .. }) {
                shadow_count += 1;
            }
        }
        assert_eq!(shadow_count, 2);
        assert_eq!(db::list_bib_items(&store.conn).unwrap().len(), 3);
    }

    #[test]
    fn enrich_bib_file_untouched() {
        use crate::bib::db;
        use crate::graph::store::Store;

        let dir = TempDir::new().unwrap();
        let bib_path = dir.path().join("refs.bib");
        let original_content = "@article{smith2024,\n  author = {Smith, John},\n  title = {Test Paper},\n  year = {2024},\n  doi = {10.1/existing}\n}\n";
        fs::write(&bib_path, original_content).unwrap();

        let store = Store::open_memory().unwrap();
        let existing = make_entry(|e| {
            e.key = "smith2024".to_string();
            e.doi = Some("10.1/existing".to_string());
        });
        db::upsert_bib_item(&store.conn, &existing, None, None, false).unwrap();

        // Simulate enrichment via DB only
        let mut fields = HashMap::new();
        fields.insert("abstract".to_string(), "New abstract".to_string());
        db::update_bib_fields(&store.conn, "smith2024", &fields).unwrap();

        // The .bib file content should remain unchanged
        let file_content = fs::read_to_string(&bib_path).unwrap();
        assert_eq!(file_content, original_content, ".bib file should be untouched by DB enrichment");
    }

    // ── EnrichResult references_linked field ─────────────────────────

    #[test]
    fn enrich_result_serializes_references_linked() {
        let result = EnrichResult {
            entry: make_entry(|_| {}),
            fields_added: vec![],
            references_found: 10,
            references_appended: 5,
            shadow_nodes_created: 3,
            references_linked: 5,
            candidates: vec![make_entry(|e| e.title = "Candidate".to_string())],
            providers_searched: vec!["openalex".to_string()],
            providers_failed: vec!["crossref".to_string()],
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["references_linked"], 5);
        assert_eq!(json["candidates"].as_array().unwrap().len(), 1);
        assert_eq!(json["providers_searched"], serde_json::json!(["openalex"]));
        assert_eq!(json["providers_failed"], serde_json::json!(["crossref"]));
    }

    // ── Enrich references linked via DB ─────────────────────────────

    #[test]
    fn enrich_references_linked_via_db() {
        use crate::bib::db;
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        // Insert parent entry
        let parent = make_entry(|e| {
            e.key = "parent2024".to_string();
        });
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        // Insert 3 reference entries and link them
        let ref_keys = ["ref_a2024", "ref_b2024", "ref_c2024"];
        for (idx, key) in ref_keys.iter().enumerate() {
            let ref_entry = make_entry(|e| {
                e.key = key.to_string();
                e.title = format!("Reference {}", idx);
            });
            db::upsert_bib_item(&store.conn, &ref_entry, None, None, true).unwrap();
            db::insert_bib_reference(&store.conn, "parent2024", key, Some(idx as i64)).unwrap();
        }

        // Assert references are linked correctly
        let refs = db::get_references_for(&store.conn, "parent2024").unwrap();
        assert_eq!(refs.len(), 3);
        assert_eq!(refs[0].key, "ref_a2024");
        assert_eq!(refs[1].key, "ref_b2024");
        assert_eq!(refs[2].key, "ref_c2024");
    }

    #[test]
    fn enrich_references_replaced_on_re_enrich() {
        use crate::bib::db;
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        // Insert parent entry
        let parent = make_entry(|e| {
            e.key = "parent2024".to_string();
        });
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        // First round: insert 3 references
        let round1_keys = ["ref_a2024", "ref_b2024", "ref_c2024"];
        for (idx, key) in round1_keys.iter().enumerate() {
            let ref_entry = make_entry(|e| {
                e.key = key.to_string();
                e.title = format!("Round1 Reference {}", idx);
            });
            db::upsert_bib_item(&store.conn, &ref_entry, None, None, true).unwrap();
            db::insert_bib_reference(&store.conn, "parent2024", key, Some(idx as i64)).unwrap();
        }
        assert_eq!(db::get_references_for(&store.conn, "parent2024").unwrap().len(), 3);

        // Second round (re-enrich): delete old, insert 2 new references
        db::delete_references_for(&store.conn, "parent2024").unwrap();
        let round2_keys = ["ref_x2024", "ref_y2024"];
        for (idx, key) in round2_keys.iter().enumerate() {
            let ref_entry = make_entry(|e| {
                e.key = key.to_string();
                e.title = format!("Round2 Reference {}", idx);
            });
            db::upsert_bib_item(&store.conn, &ref_entry, None, None, true).unwrap();
            db::insert_bib_reference(&store.conn, "parent2024", key, Some(idx as i64)).unwrap();
        }

        // Assert only round 2 references remain
        let refs = db::get_references_for(&store.conn, "parent2024").unwrap();
        assert_eq!(refs.len(), 2, "should have exactly 2 references after re-enrich");
        assert_eq!(refs[0].key, "ref_x2024");
        assert_eq!(refs[1].key, "ref_y2024");
    }

    #[test]
    fn enrich_references_dedup_skipped_uses_existing_key() {
        use crate::bib::db;
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        // Insert parent
        let parent = make_entry(|e| {
            e.key = "parent2024".to_string();
        });
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        // Insert a full entry under key "alpha2024" with DOI
        let full_entry = make_entry(|e| {
            e.key = "alpha2024".to_string();
            e.doi = Some("10.1/alpha".to_string());
            e.title = "Alpha Paper".to_string();
        });
        db::upsert_bib_item(&store.conn, &full_entry, None, None, false).unwrap();

        // Create a ref stub with a different key but the same DOI
        let stub = make_entry(|e| {
            e.key = "stub2024".to_string();
            e.doi = Some("10.1/alpha".to_string());
            e.title = "Stub Title".to_string();
        });
        let outcome = db::upsert_bib_item(&store.conn, &stub, None, None, true).unwrap();

        // Should be DedupSkipped pointing to alpha2024
        let child_key = match &outcome {
            UpsertOutcome::DedupSkipped { existing_key } => existing_key.clone(),
            _ => stub.key.clone(),
        };
        assert_eq!(child_key, "alpha2024");

        // Link using the correct key
        db::insert_bib_reference(&store.conn, "parent2024", &child_key, Some(0)).unwrap();

        // Assert reference points to alpha2024, not stub2024
        let refs = db::get_references_for(&store.conn, "parent2024").unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].key, "alpha2024");
    }

    // ── C1 regression: S2 ref stubs must not clobber existing full entries ──

    #[test]
    fn s2_ref_stub_does_not_clobber_existing_full_entry() {
        use crate::bib::db;
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        // Insert a rich, fully-populated entry under key "smith2024"
        let full_entry = make_entry(|e| {
            e.key = "smith2024".to_string();
            e.title = "Rich Paper on ML".to_string();
            e.abstract_text = Some("Detailed abstract".to_string());
            e.journal = Some("Nature".to_string());
            e.volume = Some("500".to_string());
            e.doi = Some("10.1/rich".to_string());
            e.file = Some("/path/to/paper.pdf".to_string());
        });
        db::upsert_bib_item(&store.conn, &full_entry, None, None, false).unwrap();

        // Create a minimal stub with the SAME key (simulating key collision)
        let stub = make_entry(|e| {
            e.key = "smith2024".to_string();
            e.title = "Stub Title".to_string();
            e.abstract_text = None;
            e.journal = None;
            e.volume = None;
            e.doi = None;
            e.file = None;
        });

        // Upsert with from_scan=true (new production behavior for ref stubs)
        db::upsert_bib_item(&store.conn, &stub, None, None, true).unwrap();

        // Verify existing entry is NOT clobbered
        let fetched = db::get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(fetched.title, "Rich Paper on ML", "title must not be clobbered");
        assert_eq!(fetched.abstract_text, Some("Detailed abstract".to_string()), "abstract must not be clobbered");
        assert_eq!(fetched.journal, Some("Nature".to_string()), "journal must not be clobbered");
        assert_eq!(fetched.volume, Some("500".to_string()), "volume must not be clobbered");
        assert_eq!(fetched.doi, Some("10.1/rich".to_string()), "doi must not be clobbered");
        assert_eq!(fetched.file, Some("/path/to/paper.pdf".to_string()), "file must not be clobbered");
    }

    #[test]
    fn s2_ref_stub_gap_fills_not_overwrites() {
        use crate::bib::db;
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        // Insert a partial entry with title and doi but missing abstract and journal
        let partial_entry = make_entry(|e| {
            e.key = "jones2023".to_string();
            e.title = "Original Title".to_string();
            e.doi = Some("10.1/jones".to_string());
            e.abstract_text = None;
            e.journal = None;
        });
        db::upsert_bib_item(&store.conn, &partial_entry, None, None, false).unwrap();

        // Create a stub carrying abstract and journal but also a different title
        let stub = make_entry(|e| {
            e.key = "jones2023".to_string();
            e.title = "Stub Title".to_string();
            e.doi = Some("10.1/stub-doi".to_string());
            e.abstract_text = Some("Filled abstract".to_string());
            e.journal = Some("Science".to_string());
        });

        // Upsert with from_scan=true (gap-fill semantics)
        db::upsert_bib_item(&store.conn, &stub, None, None, true).unwrap();

        let fetched = db::get_bib_item(&store.conn, "jones2023").unwrap().unwrap();
        // Existing fields preserved
        assert_eq!(fetched.title, "Original Title", "existing title must be preserved");
        assert_eq!(fetched.doi, Some("10.1/jones".to_string()), "existing doi must be preserved");
        // Missing fields filled
        assert_eq!(fetched.abstract_text, Some("Filled abstract".to_string()), "abstract should be gap-filled");
        assert_eq!(fetched.journal, Some("Science".to_string()), "journal should be gap-filled");
    }

    #[test]
    fn enrich_refs_do_not_clobber_existing_entry_regression() {
        use crate::bib::db;
        use crate::bib::semantic_scholar::{s2_ref_to_bib_entry, S2Author, S2Reference};
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        // 1. Insert a rich entry under key "smith2024"
        let full_entry = make_entry(|e| {
            e.key = "smith2024".to_string();
            e.title = "Comprehensive ML Survey".to_string();
            e.doi = Some("10.1/ml-survey".to_string());
            e.abstract_text = Some("A detailed survey...".to_string());
            e.journal = Some("Nature ML".to_string());
            e.volume = Some("10".to_string());
            e.pages = Some("1-50".to_string());
            e.file = Some("/papers/survey.pdf".to_string());
        });
        db::upsert_bib_item(&store.conn, &full_entry, None, None, false).unwrap();

        // 2. Simulate enriching another paper whose S2 references include
        //    a paper by author "Smith" from year 2024
        let s2_refs = vec![
            S2Reference {
                paper_id: Some("ref999".to_string()),
                external_ids: None,
                title: Some("Some Other ML Paper".to_string()),
                year: Some(2024),
                authors: Some(vec![
                    S2Author { author_id: Some("s1".to_string()), name: Some("J. Smith".to_string()) },
                ]),
            },
        ];

        // 3. Build batch with live keys (matching new production code)
        let mut used_keys = db::all_live_keys(&store.conn).unwrap();
        assert!(used_keys.contains("smith2024"), "smith2024 should be in live keys");

        for r in &s2_refs {
            let ref_entry = s2_ref_to_bib_entry(r, &used_keys);
            used_keys.insert(ref_entry.key.clone());

            // Upsert with from_scan=true (new production behavior)
            db::upsert_bib_item(&store.conn, &ref_entry, None, None, true).unwrap();
        }

        // 4. Assert the original smith2024 entry is completely untouched
        let original = db::get_bib_item(&store.conn, "smith2024").unwrap().unwrap();
        assert_eq!(original.title, "Comprehensive ML Survey");
        assert_eq!(original.doi, Some("10.1/ml-survey".to_string()));
        assert_eq!(original.abstract_text, Some("A detailed survey...".to_string()));
        assert_eq!(original.journal, Some("Nature ML".to_string()));
        assert_eq!(original.volume, Some("10".to_string()));
        assert_eq!(original.pages, Some("1-50".to_string()));
        assert_eq!(original.file, Some("/papers/survey.pdf".to_string()));

        // 5. Assert the reference stub got inserted under a different key
        let ref_entry = db::get_bib_item(&store.conn, "smith2024a").unwrap();
        assert!(ref_entry.is_some(), "reference stub should be inserted as smith2024a");
        let ref_entry = ref_entry.unwrap();
        assert_eq!(ref_entry.title, "Some Other ML Paper");

        // 6. Assert both entries exist
        let all = db::list_bib_items(&store.conn).unwrap();
        assert_eq!(all.len(), 2, "should have both the original and the reference stub");
    }

    // ── Crossref reference gap-filling tests ──────────────────────────

    #[test]
    fn enrich_crossref_refs_fill_gaps_after_s2() {
        use crate::bib::convert::{crossref_ref_to_bib_entry, normalize_doi, CrossrefReference};
        use crate::bib::db;
        use crate::bib::semantic_scholar::{s2_ref_to_bib_entry, S2Author, S2ExternalIds, S2Reference};
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        // Insert parent
        let parent = make_entry(|e| {
            e.key = "parent2024".to_string();
            e.doi = Some("10.1/parent".to_string());
        });
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        // S2 references: 2 entries, one with DOI "10.1/a", one without
        let s2_refs = vec![
            S2Reference {
                paper_id: Some("s2_1".to_string()),
                external_ids: Some(S2ExternalIds {
                    doi: Some("10.1/a".to_string()),
                    arxiv: None, pubmed: None, pubmed_central: None, mag: None, corpus_id: None,
                }),
                title: Some("S2 Ref A".to_string()),
                year: Some(2020),
                authors: Some(vec![S2Author { author_id: None, name: Some("A. Author".to_string()) }]),
            },
            S2Reference {
                paper_id: Some("s2_2".to_string()),
                external_ids: None,
                title: Some("S2 Ref B".to_string()),
                year: Some(2021),
                authors: Some(vec![S2Author { author_id: None, name: Some("B. Author".to_string()) }]),
            },
        ];

        // Crossref references: 3 entries
        // - DOI "10.1/a" (duplicate with S2)
        // - DOI "10.1/b" (new)
        // - No DOI (new)
        let cr_refs = vec![
            CrossrefReference {
                doi: Some("10.1/a".to_string()),
                article_title: Some("CR Ref A (dup)".to_string()),
                author: Some("A. Author".to_string()),
                year: Some("2020".to_string()),
                volume: None, first_page: None, journal_title: None, unstructured: None,
            },
            CrossrefReference {
                doi: Some("10.1/b".to_string()),
                article_title: Some("CR Ref B (new)".to_string()),
                author: Some("C. Author".to_string()),
                year: Some("2022".to_string()),
                volume: None, first_page: None, journal_title: None, unstructured: None,
            },
            CrossrefReference {
                doi: None,
                article_title: Some("CR Ref C (no DOI)".to_string()),
                author: Some("D. Author".to_string()),
                year: Some("2023".to_string()),
                volume: None, first_page: None, journal_title: None, unstructured: None,
            },
        ];

        // Clear stale edges
        db::delete_references_for(&store.conn, "parent2024").unwrap();

        let mut used_keys = db::all_live_keys(&store.conn).unwrap();
        let mut linked_dois: HashSet<String> = HashSet::new();
        let mut position = 0usize;
        let mut references_linked = 0usize;

        // Process S2 refs
        for r in s2_refs.iter().take(MAX_REFERENCES) {
            let ref_entry = s2_ref_to_bib_entry(r, &used_keys);
            used_keys.insert(ref_entry.key.clone());
            if let Some(ref d) = ref_entry.doi {
                linked_dois.insert(d.to_lowercase());
            }
            let outcome = db::upsert_bib_item(&store.conn, &ref_entry, None, None, true).unwrap();
            let child_key = match &outcome {
                UpsertOutcome::DedupSkipped { existing_key } => existing_key.clone(),
                _ => ref_entry.key.clone(),
            };
            db::insert_bib_reference(&store.conn, "parent2024", &child_key, Some(position as i64)).unwrap();
            references_linked += 1;
            position += 1;
        }

        // Process Crossref refs (fill gaps)
        let remaining_slots = MAX_REFERENCES.saturating_sub(position);
        for cr in cr_refs.iter().take(remaining_slots) {
            if let Some(ref doi) = cr.doi {
                let normalized = normalize_doi(doi).to_lowercase();
                if linked_dois.contains(&normalized) {
                    continue;
                }
            }
            let ref_entry = crossref_ref_to_bib_entry(cr, &used_keys);
            used_keys.insert(ref_entry.key.clone());
            if let Some(ref d) = ref_entry.doi {
                linked_dois.insert(d.to_lowercase());
            }
            let outcome = db::upsert_bib_item(&store.conn, &ref_entry, None, None, true).unwrap();
            let child_key = match &outcome {
                UpsertOutcome::DedupSkipped { existing_key } => existing_key.clone(),
                _ => ref_entry.key.clone(),
            };
            db::insert_bib_reference(&store.conn, "parent2024", &child_key, Some(position as i64)).unwrap();
            references_linked += 1;
            position += 1;
        }

        // Assertions
        let refs = db::get_references_for(&store.conn, "parent2024").unwrap();
        assert_eq!(refs.len(), 4, "2 S2 + 2 Crossref (1 CR skipped as DOI dup)");
        assert_eq!(references_linked, 4);

        // Position numbering is continuous
        // (get_references_for returns in position order)
        assert_eq!(refs[0].key, "author2020"); // S2 ref A
        assert_eq!(refs[1].key, "author2021"); // S2 ref B
        // CR ref A (DOI 10.1/a) skipped
        assert_eq!(refs[2].key, "author2022"); // CR ref B
        assert_eq!(refs[3].key, "author2023"); // CR ref C
    }

    #[test]
    fn enrich_crossref_only_when_s2_has_no_refs() {
        use crate::bib::convert::{crossref_ref_to_bib_entry, CrossrefReference};
        use crate::bib::db;
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        let parent = make_entry(|e| {
            e.key = "parent2024".to_string();
            e.doi = Some("10.1/parent".to_string());
        });
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        let cr_refs = vec![
            CrossrefReference {
                doi: Some("10.1/cr1".to_string()),
                article_title: Some("CR Only Ref".to_string()),
                author: Some("Solo, H.".to_string()),
                year: Some("2021".to_string()),
                volume: None, first_page: None, journal_title: None, unstructured: None,
            },
        ];

        // No S2 refs, only Crossref
        let s2_refs: Vec<()> = vec![];
        let has_any_refs = !s2_refs.is_empty() || !cr_refs.is_empty();
        assert!(has_any_refs);

        db::delete_references_for(&store.conn, "parent2024").unwrap();

        let mut used_keys = db::all_live_keys(&store.conn).unwrap();
        let mut position = 0usize;

        for cr in &cr_refs {
            let ref_entry = crossref_ref_to_bib_entry(cr, &used_keys);
            used_keys.insert(ref_entry.key.clone());
            let outcome = db::upsert_bib_item(&store.conn, &ref_entry, None, None, true).unwrap();
            let child_key = match &outcome {
                UpsertOutcome::DedupSkipped { existing_key } => existing_key.clone(),
                _ => ref_entry.key.clone(),
            };
            db::insert_bib_reference(&store.conn, "parent2024", &child_key, Some(position as i64)).unwrap();
            position += 1;
        }

        let refs = db::get_references_for(&store.conn, "parent2024").unwrap();
        assert_eq!(refs.len(), 1, "Crossref ref should be linked when S2 has none");
        assert_eq!(refs[0].doi, Some("10.1/cr1".to_string()));
    }

    #[test]
    fn enrich_crossref_respects_max_references_cap() {
        use crate::bib::convert::{crossref_ref_to_bib_entry, normalize_doi, CrossrefReference};
        use crate::bib::db;
        use crate::bib::semantic_scholar::{s2_ref_to_bib_entry, S2Author, S2Reference};
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        let parent = make_entry(|e| {
            e.key = "parent2024".to_string();
        });
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        // 25 S2 refs
        let s2_refs: Vec<S2Reference> = (0..25).map(|i| S2Reference {
            paper_id: Some(format!("s2_{}", i)),
            external_ids: None,
            title: Some(format!("S2 Paper {}", i)),
            year: Some(2020 + (i % 5) as i64),
            authors: Some(vec![S2Author {
                author_id: None,
                name: Some(format!("Author{}", i)),
            }]),
        }).collect();

        // 20 Crossref refs
        let cr_refs: Vec<CrossrefReference> = (0..20).map(|i| CrossrefReference {
            doi: Some(format!("10.1/cr{}", i)),
            article_title: Some(format!("CR Paper {}", i)),
            author: Some(format!("CrAuthor{}", i)),
            year: Some(format!("{}", 2020 + (i % 5))),
            volume: None, first_page: None, journal_title: None, unstructured: None,
        }).collect();

        db::delete_references_for(&store.conn, "parent2024").unwrap();

        let mut used_keys = db::all_live_keys(&store.conn).unwrap();
        let mut linked_dois: HashSet<String> = HashSet::new();
        let mut position = 0usize;

        // S2 first
        for r in s2_refs.iter().take(MAX_REFERENCES) {
            let ref_entry = s2_ref_to_bib_entry(r, &used_keys);
            used_keys.insert(ref_entry.key.clone());
            if let Some(ref d) = ref_entry.doi {
                linked_dois.insert(d.to_lowercase());
            }
            db::upsert_bib_item(&store.conn, &ref_entry, None, None, true).unwrap();
            db::insert_bib_reference(&store.conn, "parent2024", &ref_entry.key, Some(position as i64)).unwrap();
            position += 1;
        }

        // Crossref fills remaining slots
        let remaining_slots = MAX_REFERENCES.saturating_sub(position);
        for cr in cr_refs.iter().take(remaining_slots) {
            if let Some(ref doi) = cr.doi {
                let normalized = normalize_doi(doi).to_lowercase();
                if linked_dois.contains(&normalized) {
                    continue;
                }
            }
            let ref_entry = crossref_ref_to_bib_entry(cr, &used_keys);
            used_keys.insert(ref_entry.key.clone());
            db::upsert_bib_item(&store.conn, &ref_entry, None, None, true).unwrap();
            db::insert_bib_reference(&store.conn, "parent2024", &ref_entry.key, Some(position as i64)).unwrap();
            position += 1;
        }

        let refs = db::get_references_for(&store.conn, "parent2024").unwrap();
        assert_eq!(refs.len(), MAX_REFERENCES, "total linked refs capped at MAX_REFERENCES=30");
        assert_eq!(position, MAX_REFERENCES);
    }

    #[test]
    fn enrich_duplicate_child_key_counts_link_once() {
        use crate::bib::db;
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        // Insert parent
        let parent = make_entry(|e| {
            e.key = "parent2024".to_string();
        });
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        // Insert a child entry that both stubs will dedup to
        let child = make_entry(|e| {
            e.key = "alpha2024".to_string();
            e.doi = Some("10.1/alpha".to_string());
            e.title = "Alpha Paper".to_string();
        });
        db::upsert_bib_item(&store.conn, &child, None, None, false).unwrap();

        // Two stubs with different keys but the same DOI -> both DedupSkipped to "alpha2024"
        let stubs = vec![
            make_entry(|e| {
                e.key = "stub_a".to_string();
                e.doi = Some("10.1/alpha".to_string());
                e.title = "Stub A".to_string();
            }),
            make_entry(|e| {
                e.key = "stub_b".to_string();
                e.doi = Some("10.1/alpha".to_string());
                e.title = "Stub B".to_string();
            }),
        ];

        db::delete_references_for(&store.conn, "parent2024").unwrap();

        let mut references_linked = 0usize;
        let mut position = 0usize;

        for stub in &stubs {
            let outcome = db::upsert_bib_item(&store.conn, stub, None, None, true).unwrap();
            let child_key = match &outcome {
                UpsertOutcome::DedupSkipped { existing_key } => existing_key.clone(),
                _ => stub.key.clone(),
            };
            let inserted = db::insert_bib_reference(
                &store.conn, "parent2024", &child_key, Some(position as i64),
            ).unwrap();
            if inserted {
                references_linked += 1;
                position += 1;
            }
        }

        assert_eq!(references_linked, 1, "only one actual row inserted");
        let refs = db::get_references_for(&store.conn, "parent2024").unwrap();
        assert_eq!(refs.len(), 1, "only one reference edge should exist");
        assert_eq!(refs[0].key, "alpha2024");

        // Verify positions are contiguous (0-based)
        let positions: Vec<i64> = store.conn
            .prepare("SELECT position FROM bib_references WHERE parent_key = 'parent2024' ORDER BY position")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(positions, vec![0], "positions must be contiguous starting at 0");
    }

    // ── F4 Crossref dedup tests ─────────────────────────────────────

    /// Bug (a): An S2 ref and a DOI-less Crossref ref for the same paper
    /// (same title/year) should be deduped. Previously the Crossref loop
    /// only skipped by DOI, so a DOI-less Crossref ref always fell through.
    ///
    /// This test uses the *production* `ref_identity_key` helper and the
    /// `seen_identities` pattern that the production code must adopt.
    #[test]
    fn crossref_dedup_by_title_year_against_s2() {
        use crate::bib::convert::{crossref_ref_to_bib_entry, normalize_doi, CrossrefReference};
        use crate::bib::db;
        use crate::bib::semantic_scholar::{s2_ref_to_bib_entry, S2Author, S2Reference};
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        let parent = make_entry(|e| {
            e.key = "parent2024".to_string();
        });
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        // S2 reference: title "Machine Learning Survey", year 2023, no DOI
        let s2_refs = vec![S2Reference {
            paper_id: Some("s2_ml".to_string()),
            external_ids: None,
            title: Some("Machine Learning Survey".to_string()),
            year: Some(2023),
            authors: Some(vec![S2Author {
                author_id: None,
                name: Some("A. Author".to_string()),
            }]),
        }];

        // Crossref reference: same title and year, no DOI
        let cr_refs = vec![CrossrefReference {
            doi: None,
            article_title: Some("Machine Learning Survey".to_string()),
            author: Some("A. Author".to_string()),
            year: Some("2023".to_string()),
            volume: None,
            first_page: None,
            journal_title: None,
            unstructured: None,
        }];

        db::delete_references_for(&store.conn, "parent2024").unwrap();

        let mut used_keys = db::all_live_keys(&store.conn).unwrap();
        let mut seen_identities: HashSet<String> = HashSet::new();
        let mut position = 0usize;
        let mut references_linked = 0usize;

        // S2 pass
        for r in s2_refs.iter().take(MAX_REFERENCES) {
            let ref_entry = s2_ref_to_bib_entry(r, &used_keys);
            used_keys.insert(ref_entry.key.clone());
            if let Some(identity) = ref_identity_key(
                ref_entry.doi.as_deref(),
                &ref_entry.title,
                &ref_entry.year,
            ) {
                seen_identities.insert(identity);
            }
            let outcome =
                db::upsert_bib_item(&store.conn, &ref_entry, None, None, true).unwrap();
            let child_key = match &outcome {
                UpsertOutcome::DedupSkipped { existing_key } => existing_key.clone(),
                _ => ref_entry.key.clone(),
            };
            let inserted = db::insert_bib_reference(
                &store.conn,
                "parent2024",
                &child_key,
                Some(position as i64),
            )
            .unwrap();
            if inserted {
                references_linked += 1;
                position += 1;
            }
        }

        // Crossref pass — use identity-based dedup
        let remaining_slots = MAX_REFERENCES.saturating_sub(position);
        for cr in cr_refs.iter().take(remaining_slots) {
            let cr_title = cr
                .article_title
                .as_deref()
                .map(crate::bib::convert::strip_jats)
                .unwrap_or_default();
            let cr_year = cr.year.as_deref().unwrap_or_default();
            let cr_doi = cr.doi.as_deref().map(normalize_doi);

            if let Some(identity) =
                ref_identity_key(cr_doi.as_deref(), &cr_title, cr_year)
            {
                if !seen_identities.insert(identity) {
                    continue; // already seen
                }
            }

            let ref_entry = crossref_ref_to_bib_entry(cr, &used_keys);
            used_keys.insert(ref_entry.key.clone());
            let outcome =
                db::upsert_bib_item(&store.conn, &ref_entry, None, None, true).unwrap();
            let child_key = match &outcome {
                UpsertOutcome::DedupSkipped { existing_key } => existing_key.clone(),
                _ => ref_entry.key.clone(),
            };
            let inserted = db::insert_bib_reference(
                &store.conn,
                "parent2024",
                &child_key,
                Some(position as i64),
            )
            .unwrap();
            if inserted {
                references_linked += 1;
                position += 1;
            }
        }

        // The Crossref ref should have been deduped against the S2 ref
        let refs = db::get_references_for(&store.conn, "parent2024").unwrap();
        assert_eq!(
            refs.len(),
            1,
            "same paper (same title+year) from S2 and Crossref should be linked once, got: {:?}",
            refs.iter().map(|r| &r.key).collect::<Vec<_>>()
        );
        assert_eq!(references_linked, 1);
    }

    /// Bug (b): Two Crossref refs sharing the same DOI should be deduped.
    /// Previously `linked_dois.insert` in the Crossref loop was a dead write
    /// because it happened after the skip check, so the second ref was never
    /// caught.
    #[test]
    fn crossref_dedup_two_refs_sharing_doi() {
        use crate::bib::convert::{crossref_ref_to_bib_entry, normalize_doi, CrossrefReference};
        use crate::bib::db;
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        let parent = make_entry(|e| {
            e.key = "parent2024".to_string();
        });
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        // Two Crossref refs with the SAME DOI but different titles
        let cr_refs = vec![
            CrossrefReference {
                doi: Some("10.1234/same-paper".to_string()),
                article_title: Some("Title Variant A".to_string()),
                author: Some("Smith, J.".to_string()),
                year: Some("2022".to_string()),
                volume: None,
                first_page: None,
                journal_title: None,
                unstructured: None,
            },
            CrossrefReference {
                doi: Some("10.1234/same-paper".to_string()),
                article_title: Some("Title Variant B".to_string()),
                author: Some("Smith, J.".to_string()),
                year: Some("2022".to_string()),
                volume: None,
                first_page: None,
                journal_title: None,
                unstructured: None,
            },
        ];

        db::delete_references_for(&store.conn, "parent2024").unwrap();

        let mut used_keys = db::all_live_keys(&store.conn).unwrap();
        let mut seen_identities: HashSet<String> = HashSet::new();
        let mut position = 0usize;
        let mut references_linked = 0usize;

        // Crossref pass only (no S2 refs)
        for cr in cr_refs.iter().take(MAX_REFERENCES) {
            let cr_title = cr
                .article_title
                .as_deref()
                .map(crate::bib::convert::strip_jats)
                .unwrap_or_default();
            let cr_year = cr.year.as_deref().unwrap_or_default();
            let cr_doi = cr.doi.as_deref().map(normalize_doi);

            if let Some(identity) =
                ref_identity_key(cr_doi.as_deref(), &cr_title, cr_year)
            {
                if !seen_identities.insert(identity) {
                    continue; // already seen
                }
            }

            let ref_entry = crossref_ref_to_bib_entry(cr, &used_keys);
            used_keys.insert(ref_entry.key.clone());
            let outcome =
                db::upsert_bib_item(&store.conn, &ref_entry, None, None, true).unwrap();
            let child_key = match &outcome {
                UpsertOutcome::DedupSkipped { existing_key } => existing_key.clone(),
                _ => ref_entry.key.clone(),
            };
            let inserted = db::insert_bib_reference(
                &store.conn,
                "parent2024",
                &child_key,
                Some(position as i64),
            )
            .unwrap();
            if inserted {
                references_linked += 1;
                position += 1;
            }
        }

        // Only one of the two Crossref refs should be linked
        let refs = db::get_references_for(&store.conn, "parent2024").unwrap();
        assert_eq!(
            refs.len(),
            1,
            "two Crossref refs with same DOI should be deduped to one, got: {:?}",
            refs.iter().map(|r| &r.key).collect::<Vec<_>>()
        );
        assert_eq!(references_linked, 1);
    }

    /// Verify ref_identity_key normalizes titles consistently so that minor
    /// punctuation differences don't prevent dedup.
    #[test]
    fn ref_identity_key_title_normalization() {
        // Same logical title with different punctuation
        let id1 = ref_identity_key(None, "Hello, World! A Study", "2023");
        let id2 = ref_identity_key(None, "Hello World A Study", "2023");
        assert_eq!(id1, id2, "normalized titles should produce the same identity key");

        // DOI takes priority over title+year
        let doi_id = ref_identity_key(Some("10.1234/x"), "Hello World", "2023");
        assert!(doi_id.unwrap().starts_with("doi:"));

        // No DOI, no year -> None
        let none_id = ref_identity_key(None, "Some Title", "");
        assert!(none_id.is_none(), "should return None when year is empty");

        // No DOI, no title -> None
        let none_id2 = ref_identity_key(None, "", "2023");
        assert!(none_id2.is_none(), "should return None when title is empty");
    }

    // ── diacritics tests ────────────────────────────────────────────

    #[test]
    fn title_similarity_diacritics_panini() {
        assert_eq!(title_similarity("Pāṇini", "Panini"), 1.0);
    }

    #[test]
    fn title_similarity_diacritics_mixed() {
        let score = title_similarity(
            "Théorème de la linguistique",
            "Theoreme de la linguistique",
        );
        assert!(
            score > 0.85,
            "diacritics-only difference should score above 0.85, got {}",
            score,
        );
    }

    #[test]
    fn ref_identity_key_diacritics_normalization() {
        let id1 = ref_identity_key(None, "Pāṇini Grammar", "2020");
        let id2 = ref_identity_key(None, "Panini Grammar", "2020");
        assert_eq!(id1, id2, "diacritics should not affect identity key");
    }

    // ── F7: references_found dedup tests ────────────────────────────

    #[test]
    fn count_distinct_references_deduplicates_overlap() {
        use crate::bib::semantic_scholar::{S2ExternalIds, S2Reference};

        // 2 S2 refs: one with DOI "10.1/a", one with title+year only
        let s2_refs = vec![
            S2Reference {
                paper_id: Some("s1".to_string()),
                external_ids: Some(S2ExternalIds {
                    doi: Some("10.1/a".to_string()),
                    arxiv: None,
                    pubmed: None,
                    pubmed_central: None,
                    mag: None,
                    corpus_id: None,
                }),
                title: Some("Paper A".to_string()),
                year: Some(2020),
                authors: None,
            },
            S2Reference {
                paper_id: Some("s2".to_string()),
                external_ids: None,
                title: Some("Paper B".to_string()),
                year: Some(2021),
                authors: None,
            },
        ];

        // 2 Crossref refs: one sharing DOI "10.1/a" with S2 (overlap), one new
        let cr_refs = vec![
            CrossrefReference {
                doi: Some("10.1/a".to_string()),
                article_title: Some("Paper A variant".to_string()),
                author: None,
                year: Some("2020".to_string()),
                volume: None,
                first_page: None,
                journal_title: None,
                unstructured: None,
            },
            CrossrefReference {
                doi: Some("10.1/c".to_string()),
                article_title: Some("Paper C".to_string()),
                author: None,
                year: Some("2022".to_string()),
                volume: None,
                first_page: None,
                journal_title: None,
                unstructured: None,
            },
        ];

        // Raw count would be 4, but distinct is 3 (DOI 10.1/a appears in both)
        let count = count_distinct_references(&s2_refs, &cr_refs);
        assert_eq!(
            count, 3,
            "overlapping DOI should be deduped: 2 S2 + 1 new CR = 3"
        );
    }

    #[test]
    fn count_distinct_references_no_identity_counted_separately() {
        use crate::bib::semantic_scholar::S2Reference;

        // 2 S2 refs with no identity (no DOI, no title or no year)
        let s2_refs = vec![
            S2Reference {
                paper_id: Some("s1".to_string()),
                external_ids: None,
                title: None,
                year: None,
                authors: None,
            },
            S2Reference {
                paper_id: Some("s2".to_string()),
                external_ids: None,
                title: Some("Some title".to_string()),
                year: None, // no year -> identity is None
                authors: None,
            },
        ];

        // 1 Crossref ref with no identity
        let cr_refs = vec![CrossrefReference {
            doi: None,
            article_title: None,
            author: None,
            year: None,
            volume: None,
            first_page: None,
            journal_title: None,
            unstructured: None,
        }];

        // All 3 have no identity key, so each counts as distinct
        let count = count_distinct_references(&s2_refs, &cr_refs);
        assert_eq!(
            count, 3,
            "identity-less refs should each be counted as distinct"
        );
    }

    #[test]
    fn count_distinct_references_empty_inputs() {
        use crate::bib::semantic_scholar::S2Reference;

        let count = count_distinct_references(
            &[] as &[S2Reference],
            &[] as &[CrossrefReference],
        );
        assert_eq!(count, 0, "empty inputs should return 0");
    }

    // ── F3: concurrent fetch pattern ───────────────────────────────

    /// Validates that the concurrent-fetch pattern used in `enrich_entry`
    /// (tokio::join! with a conditional crossref future) completes in
    /// roughly the time of the slowest future, not the sum.
    #[tokio::test]
    async fn concurrent_fetches_overlap_in_time() {
        use std::time::{Duration, Instant};

        let doi: Option<String> = Some("10.1/test".to_string());
        let title = "Test Title".to_string();
        let delay = Duration::from_millis(100);

        let start = Instant::now();

        // Mirror the production pattern: crossref is conditional on DOI
        let crossref_fut = async {
            if let Some(ref _d) = doi {
                tokio::time::sleep(delay).await;
                Some("crossref-result")
            } else {
                None
            }
        };
        let s2_fut = async {
            let _title_ref = &title;
            tokio::time::sleep(delay).await;
            Some("s2-result")
        };

        let (crossref, s2) = tokio::join!(crossref_fut, s2_fut);

        let elapsed = start.elapsed();

        // Both futures sleep for `delay`. If run concurrently, total time
        // should be ~delay (not 2*delay). Allow 80ms margin.
        assert!(
            elapsed < delay + Duration::from_millis(80),
            "concurrent fetches should overlap; elapsed {:?} exceeds {:?}",
            elapsed,
            delay + Duration::from_millis(80),
        );

        assert_eq!(crossref, Some("crossref-result"));
        assert_eq!(s2, Some("s2-result"));
    }

    /// Same pattern but with doi=None — crossref future resolves immediately.
    #[tokio::test]
    async fn concurrent_fetches_no_doi_crossref_immediate() {
        use std::time::{Duration, Instant};

        let doi: Option<String> = None;
        let title = "Test Title".to_string();
        let delay = Duration::from_millis(100);

        let start = Instant::now();

        let crossref_fut = async {
            if let Some(ref _d) = doi {
                tokio::time::sleep(delay).await;
                Some("crossref-result")
            } else {
                None
            }
        };
        let s2_fut = async {
            let _title_ref = &title;
            tokio::time::sleep(delay).await;
            Some("s2-result")
        };

        let (crossref, s2) = tokio::join!(crossref_fut, s2_fut);

        let elapsed = start.elapsed();

        // crossref resolves immediately, s2 takes `delay`. Total ~delay.
        assert!(
            elapsed < delay + Duration::from_millis(80),
            "with no DOI, total time should be ~s2 delay; elapsed {:?}",
            elapsed,
        );

        assert_eq!(crossref, None);
        assert_eq!(s2, Some("s2-result"));
    }

    // ── F9: link_ref helper tests ─────────────────────────────────────

    #[test]
    fn link_ref_basic_bookkeeping() {
        use crate::bib::db;
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        // Insert parent
        let parent = make_entry(|e| {
            e.key = "parent2024".to_string();
        });
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        let mut used_keys = db::all_live_keys(&store.conn).unwrap();
        let mut counters = LinkCounters::default();

        // Link two distinct refs
        let ref_a = make_entry(|e| {
            e.key = "ref_a2024".to_string();
            e.title = "Reference A".to_string();
        });
        link_ref(&store.conn, "parent2024", &ref_a, &mut used_keys, &mut counters).unwrap();

        let ref_b = make_entry(|e| {
            e.key = "ref_b2024".to_string();
            e.title = "Reference B".to_string();
        });
        link_ref(&store.conn, "parent2024", &ref_b, &mut used_keys, &mut counters).unwrap();

        assert_eq!(counters.references_appended, 2);
        assert_eq!(counters.shadow_nodes_created, 2);
        assert_eq!(counters.references_linked, 2);
        assert_eq!(counters.position, 2);

        // used_keys should contain both refs
        assert!(used_keys.contains("ref_a2024"));
        assert!(used_keys.contains("ref_b2024"));

        // DB should have both references in position order
        let refs = db::get_references_for(&store.conn, "parent2024").unwrap();
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].key, "ref_a2024");
        assert_eq!(refs[1].key, "ref_b2024");
    }

    // ── Two-source merge_enrichment_fields ─────────────────────────

    #[test]
    fn merge_two_sources_crossref_preferred() {
        // When both CrossRef and S2 provide a value, CrossRef wins
        let existing = make_entry(|_| {});
        let crossref = make_entry(|e| {
            e.abstract_text = Some("CrossRef abstract".to_string());
            e.doi = Some("10.1/crossref-doi".to_string());
        });
        let s2 = make_entry(|e| {
            e.abstract_text = Some("S2 abstract".to_string());
            e.journal = Some("S2 Journal".to_string());
        });

        let merged = merge_enrichment_fields(&existing, Some(&crossref), Some(&s2));
        // CrossRef wins for abstract since both have it
        assert_eq!(merged.get("abstract").unwrap(), "CrossRef abstract");
        // S2 fills the gap for journal since CrossRef doesn't have it
        assert_eq!(merged.get("journal").unwrap(), "S2 Journal");
        assert_eq!(merged.get("doi").unwrap(), "10.1/crossref-doi");
    }

    #[test]
    fn merge_two_sources_s2_fills_crossref_gaps() {
        let existing = make_entry(|_| {});
        let crossref = make_entry(|e| {
            e.doi = Some("10.1/x".to_string());
            e.journal = None; // CrossRef doesn't have journal
        });
        let s2 = make_entry(|e| {
            e.journal = Some("S2 Journal".to_string());
            e.url = Some("https://s2.example.com".to_string());
        });

        let merged = merge_enrichment_fields(&existing, Some(&crossref), Some(&s2));
        assert_eq!(merged.get("doi").unwrap(), "10.1/x");
        assert_eq!(merged.get("journal").unwrap(), "S2 Journal");
        assert_eq!(merged.get("url").unwrap(), "https://s2.example.com");
    }

    #[test]
    fn merge_two_sources_both_none_returns_empty() {
        let existing = make_entry(|_| {});
        let merged = merge_enrichment_fields(&existing, None, None);
        assert!(merged.is_empty());
    }

    #[test]
    fn merge_two_sources_crossref_only() {
        // When only crossref is provided (s2=None), same as single-source
        let existing = make_entry(|_| {});
        let crossref = make_entry(|e| {
            e.doi = Some("10.1/cr".to_string());
        });
        let merged = merge_enrichment_fields(&existing, Some(&crossref), None);
        assert_eq!(merged.get("doi").unwrap(), "10.1/cr");
    }

    #[test]
    fn merge_two_sources_s2_only() {
        // When only s2 is provided (crossref=None), s2 fills
        let existing = make_entry(|_| {});
        let s2 = make_entry(|e| {
            e.journal = Some("S2 Only Journal".to_string());
        });
        let merged = merge_enrichment_fields(&existing, None, Some(&s2));
        assert_eq!(merged.get("journal").unwrap(), "S2 Only Journal");
    }

    #[test]
    fn merge_two_sources_crossref_empty_string_s2_fills() {
        // CrossRef has empty string for a field, S2 has a real value => S2 wins
        let existing = make_entry(|_| {});
        let crossref = make_entry(|e| {
            e.journal = Some("".to_string()); // empty string
        });
        let s2 = make_entry(|e| {
            e.journal = Some("S2 Journal".to_string());
        });
        let merged = merge_enrichment_fields(&existing, Some(&crossref), Some(&s2));
        assert_eq!(merged.get("journal").unwrap(), "S2 Journal");
    }

    // ── link_references_from_sources helper ─────────────────────────

    #[test]
    fn link_references_from_sources_basic() {
        use crate::bib::convert::StringOrSeq;
        use crate::bib::db;
        use crate::bib::semantic_scholar::{S2Author, S2ExternalIds, S2Reference};
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        // Insert parent
        let parent = make_entry(|e| {
            e.key = "parent2024".to_string();
        });
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        // Build S2 result with 1 ref
        let s2_paper = S2Paper {
            paper_id: Some("s2_parent".to_string()),
            title: Some("Parent Paper".to_string()),
            year: Some(2024),
            authors: None,
            external_ids: None,
            abstract_text: None,
            references: Some(vec![S2Reference {
                paper_id: Some("s2_ref1".to_string()),
                external_ids: Some(S2ExternalIds {
                    doi: Some("10.1/ref1".to_string()),
                    arxiv: None, pubmed: None, pubmed_central: None, mag: None, corpus_id: None,
                }),
                title: Some("S2 Ref Paper".to_string()),
                year: Some(2020),
                authors: Some(vec![S2Author { author_id: None, name: Some("A. Author".to_string()) }]),
            }]),
            venue: None,
            url: None,
            reference_count: None,
            citation_count: None,
            tldr: None,
            journal: None,
            open_access_pdf: None,
        };
        // Build a CrossRef CSL item with 1 ref
        let crossref_csl = CslItem {
            doi: Some("10.1/parent".to_string()),
            title: Some(StringOrSeq::Seq(vec!["Parent Paper".to_string()])),
            author: None,
            item_type: Some("journal-article".to_string()),
            container_title: None,
            issued: None,
            reference: Some(vec![CrossrefReference {
                doi: Some("10.1/crref1".to_string()),
                article_title: Some("CR Ref Paper".to_string()),
                author: Some("B. Author".to_string()),
                year: Some("2021".to_string()),
                volume: None, first_page: None, journal_title: None, unstructured: None,
            }]),
            volume: None,
            issue: None,
            page: None,
            publisher: None,
            issn: None,
            isbn: None,
            abstract_text: None,
            url: None,
            subject: None,
        };

        let (refs_found, counters) = link_references_from_sources(
            &store.conn,
            "parent2024",
            Some(&crossref_csl),
            Some(&s2_paper),
            None,
        ).unwrap();

        // 2 distinct references (different DOIs)
        assert_eq!(refs_found, 2);
        assert_eq!(counters.references_linked, 2);
        assert_eq!(counters.shadow_nodes_created, 2);

        let refs = db::get_references_for(&store.conn, "parent2024").unwrap();
        assert_eq!(refs.len(), 2);
    }

    #[test]
    fn link_references_from_sources_no_refs() {
        use crate::bib::db;
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        let parent = make_entry(|e| {
            e.key = "parent2024".to_string();
        });
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        // No sources at all
        let (refs_found, counters) = link_references_from_sources(
            &store.conn,
            "parent2024",
            None,
            None,
            None,
        ).unwrap();

        assert_eq!(refs_found, 0);
        assert_eq!(counters.references_linked, 0);
    }

    /// Regression test: when no DOI is available, reference linking should
    /// still work via S2 title-based discovery (the `else` branch in Path B).
    /// This test verifies that `link_references_from_sources` works correctly
    /// with S2-only data (no CrossRef), which is the codepath exercised when
    /// `enriched_doi` is `None`.
    #[test]
    fn link_references_from_sources_s2_only_no_crossref() {
        use crate::bib::db;
        use crate::bib::semantic_scholar::{S2Author, S2Reference};
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        // Insert parent (no DOI -- the case this bug fix targets)
        let parent = make_entry(|e| {
            e.key = "book2024".to_string();
            e.title = "A Book Without DOI".to_string();
            e.doi = None;
        });
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        // Build S2 result with references (as would come from paperId lookup)
        let s2_paper = S2Paper {
            paper_id: Some("s2_book".to_string()),
            title: Some("A Book Without DOI".to_string()),
            year: Some(2024),
            authors: None,
            external_ids: None,
            abstract_text: None,
            references: Some(vec![
                S2Reference {
                    paper_id: Some("ref1".to_string()),
                    external_ids: None,
                    title: Some("Chapter Reference A".to_string()),
                    year: Some(2020),
                    authors: Some(vec![S2Author { author_id: None, name: Some("A. Author".to_string()) }]),
                },
                S2Reference {
                    paper_id: Some("ref2".to_string()),
                    external_ids: None,
                    title: Some("Chapter Reference B".to_string()),
                    year: Some(2019),
                    authors: Some(vec![S2Author { author_id: None, name: Some("B. Writer".to_string()) }]),
                },
            ]),
            venue: None,
            url: None,
            reference_count: None,
            citation_count: None,
            tldr: None,
            journal: None,
            open_access_pdf: None,
        };
        // Call link_references_from_sources with no CrossRef (None), S2 only
        let (refs_found, counters) = link_references_from_sources(
            &store.conn,
            "book2024",
            None,           // no CrossRef
            Some(&s2_paper),
            None,
        ).unwrap();

        assert_eq!(refs_found, 2, "should find 2 references from S2");
        assert_eq!(counters.references_linked, 2, "both should be linked");
        assert_eq!(counters.shadow_nodes_created, 2, "both should create shadow nodes");

        let refs = db::get_references_for(&store.conn, "book2024").unwrap();
        assert_eq!(refs.len(), 2, "parent should have 2 reference edges");
    }

    #[test]
    fn link_ref_dedup_skipped_counts_correctly() {
        use crate::bib::db;
        use crate::graph::store::Store;

        let store = Store::open_memory().unwrap();

        // Insert parent
        let parent = make_entry(|e| {
            e.key = "parent2024".to_string();
        });
        db::upsert_bib_item(&store.conn, &parent, None, None, false).unwrap();

        // Pre-insert a full entry with a DOI
        let full_entry = make_entry(|e| {
            e.key = "alpha2024".to_string();
            e.doi = Some("10.1/alpha".to_string());
            e.title = "Alpha Paper".to_string();
        });
        db::upsert_bib_item(&store.conn, &full_entry, None, None, false).unwrap();

        let mut used_keys = db::all_live_keys(&store.conn).unwrap();
        let mut counters = LinkCounters::default();

        // Call link_ref with a stub sharing the same DOI -> DedupSkipped
        let stub = make_entry(|e| {
            e.key = "stub2024".to_string();
            e.doi = Some("10.1/alpha".to_string());
            e.title = "Stub Title".to_string();
        });
        link_ref(&store.conn, "parent2024", &stub, &mut used_keys, &mut counters).unwrap();

        // DedupSkipped: appended but NOT a new shadow
        assert_eq!(counters.references_appended, 1);
        assert_eq!(counters.shadow_nodes_created, 0, "DedupSkipped should not count as shadow");
        assert_eq!(counters.references_linked, 1);
        assert_eq!(counters.position, 1);

        // Reference should point to alpha2024, not stub2024
        let refs = db::get_references_for(&store.conn, "parent2024").unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].key, "alpha2024");
    }
}
