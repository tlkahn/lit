pub mod identifiers;
pub mod resolve;

// Re-export PdfRecognizerData from its canonical home in the pdf module.
// The recognize module consumes this type (e.g. extract_identifiers in #441);
// it does not define it.
pub use crate::pdf::PdfRecognizerData;

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_pdf_recognizer_data_is_serializable() {
        let data = PdfRecognizerData {
            pages: vec!["page one text".to_string()],
            total_pages: 1,
            info: HashMap::new(),
        };
        let json = serde_json::to_string(&data);
        assert!(json.is_ok());
        let json_str = json.unwrap();
        assert!(json_str.contains("page one text"));
        assert!(json_str.contains("\"total_pages\":1"));
    }

    #[test]
    fn test_pdf_recognizer_data_is_clone() {
        let mut info = HashMap::new();
        info.insert("Title".to_string(), "Advances in Neural Retrieval Models for Scholarly Document Processing".to_string());
        info.insert("Author".to_string(), "Dr. Elena Vasquez and Prof. Martin Chen".to_string());
        let data = PdfRecognizerData {
            pages: vec!["comprehensive survey of neural retrieval models".to_string()],
            total_pages: 7,
            info,
        };
        let cloned = data.clone();
        assert_eq!(cloned.pages, data.pages);
        assert_eq!(cloned.total_pages, data.total_pages);
        assert_eq!(cloned.info, data.info);
    }

    #[test]
    fn test_pdf_recognizer_data_default_fields() {
        let data = PdfRecognizerData {
            pages: vec![],
            total_pages: 0,
            info: HashMap::new(),
        };
        assert!(data.pages.is_empty());
        assert_eq!(data.total_pages, 0);
        assert!(data.info.is_empty());
    }
}
