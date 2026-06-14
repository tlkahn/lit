use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};

use futures::StreamExt;
use tauri::Emitter;

use crate::bib::semantic_scholar;
use crate::bib::types::BibEntry;
use crate::bib::unpaywall;
use crate::recognize::attach::{generate_pdf_path, PDF_ASSET_DIR};
use crate::recognize::resolve::ResolveError;

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("HTTP error: {0}")]
    Http(String),

    #[error("invalid content: expected PDF, got non-PDF data")]
    InvalidContent,

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

pub(crate) static DOWNLOAD_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent(format!(
            "lit/{} (https://github.com/tlkahn/lit)",
            env!("LIT_GIT_VERSION")
        ))
        .build()
        .expect("failed to build download client")
});

pub async fn download_pdf<F>(
    client: &reqwest::Client,
    url: &str,
    workspace_root: &Path,
    cite_key: &str,
    progress_cb: Option<F>,
) -> Result<String, DownloadError>
where
    F: Fn(u64, Option<u64>),
{
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| DownloadError::Http(e.to_string()))?;

    if !resp.status().is_success() {
        return Err(DownloadError::Http(format!("status {}", resp.status())));
    }

    let total_size = resp.content_length();

    let dest_dir = workspace_root.join(PDF_ASSET_DIR);
    std::fs::create_dir_all(&dest_dir)?;
    let mut tmp = tempfile::NamedTempFile::new_in(&dest_dir)?;

    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;

    {
        use std::io::Write;
        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| DownloadError::Http(e.to_string()))?;
            tmp.write_all(&chunk)?;
            downloaded += chunk.len() as u64;
            if let Some(ref cb) = progress_cb {
                cb(downloaded, total_size);
            }
        }
        tmp.flush()?;
    }

    {
        use std::io::{Read, Seek, SeekFrom};
        tmp.seek(SeekFrom::Start(0))?;
        let mut magic = [0u8; 4];
        tmp.read_exact(&mut magic)
            .map_err(|_| DownloadError::InvalidContent)?;
        if &magic != b"%PDF" {
            return Err(DownloadError::InvalidContent);
        }
    }

    let filename = format!("{}.pdf", cite_key);
    let final_path = generate_pdf_path(workspace_root, &filename)
        .map_err(|e| DownloadError::Io(std::io::Error::other(e)))?;
    tmp.persist(&final_path)
        .map_err(|e| DownloadError::Io(e.error))?;

    let relative = final_path
        .strip_prefix(workspace_root)
        .unwrap_or(&final_path);
    Ok(relative
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/"))
}

pub async fn resolve_pdf_url(
    client: &reqwest::Client,
    entry: &BibEntry,
    unpaywall_base: &str,
    s2_base: &str,
) -> Result<Option<String>, ResolveError> {
    if let Some(ref arxiv_id) = entry.arxiv_id {
        let id = arxiv_id.trim();
        if !id.is_empty() {
            return Ok(Some(format!("https://arxiv.org/pdf/{}.pdf", id)));
        }
    }

    let doi = match entry.doi {
        Some(ref d) if !d.trim().is_empty() => d.trim(),
        _ => return Ok(None),
    };

    match unpaywall::lookup_oa_pdf_url_with_base(client, doi, unpaywall_base).await {
        Ok(Some(url)) => return Ok(Some(url)),
        Ok(None) => {}
        Err(ResolveError::RateLimited) => {
            tracing::warn!("Unpaywall rate-limited, trying Semantic Scholar");
        }
        Err(e) => tracing::warn!(error = %e, "Unpaywall lookup failed, trying Semantic Scholar"),
    }

    match semantic_scholar::lookup_by_doi_with_base(client, doi, s2_base).await {
        Ok(paper) => Ok(semantic_scholar::extract_oa_pdf_url(&paper)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub async fn download_entry_pdf(
    key: String,
    workspace_path: String,
    graph_state: tauri::State<'_, Arc<crate::commands::graph::GraphRegistry>>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let root = PathBuf::from(&workspace_path);
    let gi = crate::commands::page::lookup_graph_index(&graph_state, &root)
        .ok_or_else(|| "Graph index not ready".to_string())?;

    let entry = {
        let store = gi.store();
        crate::bib::db::get_bib_item(&store.conn, &key)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Entry '{}' not found", key))?
    };

    if let Some(ref file) = entry.file {
        if !file.is_empty() {
            return Ok(file.clone());
        }
    }

    let url = resolve_pdf_url(
        &DOWNLOAD_CLIENT,
        &entry,
        unpaywall::UNPAYWALL_BASE_URL,
        semantic_scholar::S2_BASE_URL,
    )
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No open-access PDF found".to_string())?;

    let app = app_handle.clone();
    let emit_key = key.clone();
    let relative_path = download_pdf(
        &DOWNLOAD_CLIENT,
        &url,
        &root,
        &key,
        Some(move |downloaded: u64, total: Option<u64>| {
            let _ = app.emit(
                "lit:pdf-download-progress",
                serde_json::json!({
                    "key": emit_key,
                    "bytes_downloaded": downloaded,
                    "bytes_total": total,
                }),
            );
        }),
    )
    .await
    .map_err(|e| e.to_string())?;

    {
        let store = gi.store();
        let mut fields = HashMap::new();
        fields.insert("file".to_string(), relative_path.clone());
        crate::bib::db::update_bib_fields(&store.conn, &key, &fields)
            .map_err(|e| e.to_string())?;
    }

    crate::commands::graph::notify_bib_changed(&graph_state, &root, &app_handle);

    // Ensure companion.searchPath includes "assets/pdf" so companion
    // resolution works even if the user never runs OCR on this PDF.
    crate::commands::ocr::ensure_companion_search_path(&app_handle)?;

    Ok(relative_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path, path_regex};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap()
    }

    fn make_entry(doi: Option<&str>, arxiv_id: Option<&str>) -> BibEntry {
        BibEntry {
            key: "test2024".to_string(),
            authors: vec![],
            title: "Test".to_string(),
            year: "2024".to_string(),
            entry_type: "article".to_string(),
            line_number: 0,
            bib_file: None,
            abstract_text: None,
            doi: doi.map(String::from),
            journal: None,
            url: None,
            file: None,
            volume: None,
            number: None,
            pages: None,
            publisher: None,
            issn: None,
            isbn: None,
            arxiv_id: arxiv_id.map(String::from),
            tags: vec![],
        }
    }

    #[tokio::test]
    async fn arxiv_id_returns_direct_url() {
        let client = test_client();
        let entry = make_entry(Some("10.1038/test"), Some("2301.07041"));

        let result = resolve_pdf_url(
            &client,
            &entry,
            "http://localhost:1",
            "http://localhost:1",
        )
        .await
        .unwrap();

        assert_eq!(
            result,
            Some("https://arxiv.org/pdf/2301.07041.pdf".to_string())
        );
    }

    #[tokio::test]
    async fn doi_unpaywall_returns_pdf() {
        let server = MockServer::start().await;
        let client = test_client();

        let body = r#"{
            "doi": "10.1038/nature12373",
            "is_oa": true,
            "best_oa_location": {
                "url_for_pdf": "https://europepmc.org/paper.pdf"
            }
        }"#;

        Mock::given(method("GET"))
            .and(path_regex(r"/v2/10\.1038/nature12373"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path_regex(r"/graph/v1/paper/DOI:.*"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;

        let entry = make_entry(Some("10.1038/nature12373"), None);
        let result = resolve_pdf_url(&client, &entry, &server.uri(), &server.uri())
            .await
            .unwrap();

        assert_eq!(
            result,
            Some("https://europepmc.org/paper.pdf".to_string())
        );
    }

    #[tokio::test]
    async fn doi_unpaywall_empty_s2_fallback() {
        let unpaywall_server = MockServer::start().await;
        let s2_server = MockServer::start().await;
        let client = test_client();

        let unpaywall_body = r#"{
            "doi": "10.1038/nature12373",
            "is_oa": false,
            "best_oa_location": null
        }"#;

        Mock::given(method("GET"))
            .and(path_regex(r"/v2/.*"))
            .respond_with(ResponseTemplate::new(200).set_body_string(unpaywall_body))
            .mount(&unpaywall_server)
            .await;

        let s2_body = r#"{
            "paperId": "abc",
            "title": "Test Paper",
            "openAccessPdf": {
                "url": "https://s2-pdf.example.com/paper.pdf"
            }
        }"#;

        Mock::given(method("GET"))
            .and(path_regex(r"/graph/v1/paper/DOI:.*"))
            .respond_with(ResponseTemplate::new(200).set_body_string(s2_body))
            .mount(&s2_server)
            .await;

        let entry = make_entry(Some("10.1038/nature12373"), None);
        let result = resolve_pdf_url(
            &client,
            &entry,
            &unpaywall_server.uri(),
            &s2_server.uri(),
        )
        .await
        .unwrap();

        assert_eq!(
            result,
            Some("https://s2-pdf.example.com/paper.pdf".to_string())
        );
    }

    #[tokio::test]
    async fn no_identifiers_returns_none() {
        let client = test_client();
        let entry = make_entry(None, None);

        let result = resolve_pdf_url(
            &client,
            &entry,
            "http://localhost:1",
            "http://localhost:1",
        )
        .await
        .unwrap();

        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn all_sources_empty_returns_none() {
        let unpaywall_server = MockServer::start().await;
        let s2_server = MockServer::start().await;
        let client = test_client();

        Mock::given(method("GET"))
            .and(path_regex(r"/v2/.*"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&unpaywall_server)
            .await;

        let s2_body = r#"{"paperId": "abc", "title": "Test Paper"}"#;
        Mock::given(method("GET"))
            .and(path_regex(r"/graph/v1/paper/DOI:.*"))
            .respond_with(ResponseTemplate::new(200).set_body_string(s2_body))
            .mount(&s2_server)
            .await;

        let entry = make_entry(Some("10.1038/nature12373"), None);
        let result = resolve_pdf_url(
            &client,
            &entry,
            &unpaywall_server.uri(),
            &s2_server.uri(),
        )
        .await
        .unwrap();

        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn unpaywall_rate_limited_falls_through_to_s2() {
        let unpaywall_server = MockServer::start().await;
        let s2_server = MockServer::start().await;
        let client = test_client();

        Mock::given(method("GET"))
            .and(path_regex(r"/v2/.*"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&unpaywall_server)
            .await;

        let s2_body = r#"{
            "paperId": "abc",
            "title": "Test Paper",
            "openAccessPdf": {
                "url": "https://s2-pdf.example.com/fallback.pdf"
            }
        }"#;

        Mock::given(method("GET"))
            .and(path_regex(r"/graph/v1/paper/DOI:.*"))
            .respond_with(ResponseTemplate::new(200).set_body_string(s2_body))
            .mount(&s2_server)
            .await;

        let entry = make_entry(Some("10.1038/nature12373"), None);
        let result = resolve_pdf_url(
            &client,
            &entry,
            &unpaywall_server.uri(),
            &s2_server.uri(),
        )
        .await
        .unwrap();

        assert_eq!(
            result,
            Some("https://s2-pdf.example.com/fallback.pdf".to_string())
        );
    }

    // ── download_pdf tests ─────────────────────────────────────────

    #[tokio::test]
    async fn download_pdf_success() {
        let server = MockServer::start().await;
        let workspace = tempfile::TempDir::new().unwrap();

        Mock::given(method("GET"))
            .and(path("/paper.pdf"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_bytes(b"%PDF-1.4 fake pdf content here".as_slice()),
            )
            .mount(&server)
            .await;

        let url = format!("{}/paper.pdf", server.uri());
        let result = download_pdf(
            &test_client(),
            &url,
            workspace.path(),
            "smith2024",
            None::<fn(u64, Option<u64>)>,
        )
        .await;

        let rel_path = result.unwrap();
        assert_eq!(rel_path, "assets/pdf/smith2024.pdf");
        let abs_path = workspace.path().join(&rel_path);
        assert!(abs_path.exists());
        let content = std::fs::read(&abs_path).unwrap();
        assert_eq!(&content[..4], b"%PDF");
    }

    #[tokio::test]
    async fn download_pdf_invalid_content() {
        let server = MockServer::start().await;
        let workspace = tempfile::TempDir::new().unwrap();

        Mock::given(method("GET"))
            .and(path("/not-a-pdf"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string("<html><body>Access Denied</body></html>"),
            )
            .mount(&server)
            .await;

        let url = format!("{}/not-a-pdf", server.uri());
        let result = download_pdf(
            &test_client(),
            &url,
            workspace.path(),
            "test2024",
            None::<fn(u64, Option<u64>)>,
        )
        .await;

        assert!(matches!(result, Err(DownloadError::InvalidContent)));
    }

    #[tokio::test]
    async fn download_pdf_http_error() {
        let server = MockServer::start().await;
        let workspace = tempfile::TempDir::new().unwrap();

        Mock::given(method("GET"))
            .and(path("/missing.pdf"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let url = format!("{}/missing.pdf", server.uri());
        let result = download_pdf(
            &test_client(),
            &url,
            workspace.path(),
            "test2024",
            None::<fn(u64, Option<u64>)>,
        )
        .await;

        assert!(matches!(result, Err(DownloadError::Http(_))));
    }

    #[tokio::test]
    async fn download_pdf_progress_callback() {
        let server = MockServer::start().await;
        let workspace = tempfile::TempDir::new().unwrap();

        let body = b"%PDF-1.4 some fake pdf content for progress tracking test";
        Mock::given(method("GET"))
            .and(path("/progress.pdf"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-length", body.len().to_string().as_str())
                    .set_body_bytes(body.as_slice()),
            )
            .mount(&server)
            .await;

        let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let calls_clone = calls.clone();

        let url = format!("{}/progress.pdf", server.uri());
        let result = download_pdf(
            &test_client(),
            &url,
            workspace.path(),
            "progress2024",
            Some(move |downloaded: u64, total: Option<u64>| {
                calls_clone.lock().unwrap().push((downloaded, total));
            }),
        )
        .await;

        assert!(result.is_ok());
        let recorded = calls.lock().unwrap();
        assert!(!recorded.is_empty(), "progress callback should have been called at least once");
        let (final_downloaded, final_total) = recorded.last().unwrap();
        assert_eq!(*final_downloaded, body.len() as u64);
        assert_eq!(*final_total, Some(body.len() as u64));
    }

    #[tokio::test]
    async fn download_pdf_collision_safe_naming() {
        let server = MockServer::start().await;
        let workspace = tempfile::TempDir::new().unwrap();

        let pdf_dir = workspace.path().join("assets/pdf");
        std::fs::create_dir_all(&pdf_dir).unwrap();
        std::fs::write(pdf_dir.join("smith2024.pdf"), b"%PDF-existing").unwrap();

        Mock::given(method("GET"))
            .and(path("/paper.pdf"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_bytes(b"%PDF-1.4 new download".as_slice()),
            )
            .mount(&server)
            .await;

        let url = format!("{}/paper.pdf", server.uri());
        let result = download_pdf(
            &test_client(),
            &url,
            workspace.path(),
            "smith2024",
            None::<fn(u64, Option<u64>)>,
        )
        .await;

        assert_eq!(result.unwrap(), "assets/pdf/smith2024-1.pdf");
    }

    #[tokio::test]
    async fn download_client_uses_connect_timeout_not_overall_timeout() {
        let server = MockServer::start().await;

        let body = b"%PDF-1.4 fake pdf content here";
        Mock::given(method("GET"))
            .and(path("/slow.pdf"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_bytes(body.as_slice())
                    .set_delay(std::time::Duration::from_secs(3)),
            )
            .mount(&server)
            .await;

        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        let workspace = tempfile::TempDir::new().unwrap();
        let url = format!("{}/slow.pdf", server.uri());
        let result = download_pdf(
            &client,
            &url,
            workspace.path(),
            "slow2024",
            None::<fn(u64, Option<u64>)>,
        )
        .await;

        assert!(result.is_ok(), "download should succeed with connect_timeout only (no overall timeout)");

        let client_with_overall = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(1))
            .build()
            .unwrap();

        let result2 = download_pdf(
            &client_with_overall,
            &url,
            workspace.path(),
            "slow2024b",
            None::<fn(u64, Option<u64>)>,
        )
        .await;

        assert!(result2.is_err(), "download should fail with a tight overall timeout");
    }

    #[tokio::test]
    async fn download_pdf_empty_response() {
        let server = MockServer::start().await;
        let workspace = tempfile::TempDir::new().unwrap();

        Mock::given(method("GET"))
            .and(path("/empty.pdf"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(Vec::new()))
            .mount(&server)
            .await;

        let url = format!("{}/empty.pdf", server.uri());
        let result = download_pdf(
            &test_client(),
            &url,
            workspace.path(),
            "empty2024",
            None::<fn(u64, Option<u64>)>,
        )
        .await;

        assert!(matches!(result, Err(DownloadError::InvalidContent)));
    }
}
