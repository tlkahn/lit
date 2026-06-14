use serde::Deserialize;

use crate::recognize::resolve::doi::percent_encode_doi_path;
use crate::recognize::resolve::ResolveError;

#[derive(Debug, Clone, Deserialize)]
pub struct OaLocation {
    pub url_for_pdf: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UnpaywallResponse {
    pub best_oa_location: Option<OaLocation>,
}

pub(crate) const UNPAYWALL_BASE_URL: &str = "https://api.unpaywall.org";

const UNPAYWALL_EMAIL: &str = "lit@lit.solar";

pub(crate) async fn lookup_oa_pdf_url_with_base(
    client: &reqwest::Client,
    doi: &str,
    base_url: &str,
) -> Result<Option<String>, ResolveError> {
    let url = format!("{}/v2/{}?email={}", base_url, percent_encode_doi_path(doi), UNPAYWALL_EMAIL);

    let resp = client.get(&url).send().await.map_err(|e| {
        ResolveError::Http(format!("Unpaywall request failed: {}", e))
    })?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    let resp = crate::recognize::resolve::check_status(resp, "Unpaywall API")?;

    let body = resp.text().await.map_err(|e| {
        ResolveError::Parse(format!("Failed to read Unpaywall response: {}", e))
    })?;

    let parsed: UnpaywallResponse = serde_json::from_str(&body).map_err(|e| {
        ResolveError::Parse(format!("Failed to parse Unpaywall response: {}", e))
    })?;

    Ok(parsed.best_oa_location.and_then(|loc| loc.url_for_pdf))
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path_regex, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap()
    }

    #[tokio::test]
    async fn happy_path_with_pdf_url() {
        let server = MockServer::start().await;
        let body = r#"{
            "doi": "10.1038/nature12373",
            "is_oa": true,
            "best_oa_location": {
                "url_for_pdf": "https://europepmc.org/articles/pmc123/pdf/main.pdf"
            }
        }"#;

        Mock::given(method("GET"))
            .and(path_regex(r"/v2/10\.1038/nature12373"))
            .and(query_param("email", "lit@lit.solar"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let client = test_client();
        let result = lookup_oa_pdf_url_with_base(&client, "10.1038/nature12373", &server.uri())
            .await
            .unwrap();

        assert_eq!(
            result,
            Some("https://europepmc.org/articles/pmc123/pdf/main.pdf".to_string())
        );
    }

    #[tokio::test]
    async fn happy_path_without_pdf_url() {
        let server = MockServer::start().await;
        let body = r#"{
            "doi": "10.1038/nature12373",
            "is_oa": true,
            "best_oa_location": {
                "url_for_pdf": null
            }
        }"#;

        Mock::given(method("GET"))
            .and(path_regex(r"/v2/10\.1038/nature12373"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let client = test_client();
        let result = lookup_oa_pdf_url_with_base(&client, "10.1038/nature12373", &server.uri())
            .await
            .unwrap();

        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn no_oa_location() {
        let server = MockServer::start().await;
        let body = r#"{
            "doi": "10.1038/nature12373",
            "is_oa": false,
            "best_oa_location": null
        }"#;

        Mock::given(method("GET"))
            .and(path_regex(r"/v2/10\.1038/nature12373"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let client = test_client();
        let result = lookup_oa_pdf_url_with_base(&client, "10.1038/nature12373", &server.uri())
            .await
            .unwrap();

        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn doi_not_found_returns_none() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path_regex(r"/v2/.*"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let client = test_client();
        let result = lookup_oa_pdf_url_with_base(&client, "10.9999/nonexistent", &server.uri())
            .await
            .unwrap();

        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn sici_doi_with_special_chars_encodes_path() {
        let server = MockServer::start().await;

        let sici_doi = "10.1002/(SICI)1097-0258(19980815/30)17:15/16<1683::AID-SIM968>3.0.CO;2-S";
        let encoded_path =
            "/v2/10.1002/(SICI)1097-0258(19980815/30)17:15/16%3C1683::AID-SIM968%3E3.0.CO;2-S";

        let body = r#"{
            "doi": "10.1002/(SICI)1097-0258(19980815/30)17:15/16<1683::AID-SIM968>3.0.CO;2-S",
            "is_oa": true,
            "best_oa_location": {
                "url_for_pdf": "https://example.com/sici.pdf"
            }
        }"#;

        use wiremock::matchers::path;
        Mock::given(method("GET"))
            .and(path(encoded_path))
            .and(query_param("email", "lit@lit.solar"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let client = test_client();
        let result = lookup_oa_pdf_url_with_base(&client, sici_doi, &server.uri())
            .await
            .unwrap();

        assert_eq!(
            result,
            Some("https://example.com/sici.pdf".to_string())
        );
    }

    #[tokio::test]
    async fn doi_with_question_mark_encodes_path() {
        let server = MockServer::start().await;

        let doi = "10.1000/test?param";
        let encoded_path = "/v2/10.1000/test%3Fparam";

        let body = r#"{
            "doi": "10.1000/test?param",
            "is_oa": true,
            "best_oa_location": {
                "url_for_pdf": "https://example.com/qmark.pdf"
            }
        }"#;

        use wiremock::matchers::path;
        Mock::given(method("GET"))
            .and(path(encoded_path))
            .and(query_param("email", "lit@lit.solar"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let client = test_client();
        let result = lookup_oa_pdf_url_with_base(&client, doi, &server.uri())
            .await
            .unwrap();

        assert_eq!(
            result,
            Some("https://example.com/qmark.pdf".to_string())
        );
    }

    #[tokio::test]
    async fn rate_limited_returns_error() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path_regex(r"/v2/.*"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&server)
            .await;

        let client = test_client();
        let result = lookup_oa_pdf_url_with_base(&client, "10.1038/nature12373", &server.uri())
            .await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ResolveError::RateLimited => {}
            other => panic!("expected RateLimited, got {:?}", other),
        }
    }
}
