use crate::citation;
use crate::config::DocumentConfig;
use crate::parser::{scan::scan_document, ParserRegistry};
use crate::renderer;
use crate::resolver::ReferenceMap;
use crate::definition_tag;
use crate::types::{Citation, Definition, ResolvedCitation, ResolvedDefinitionTag};

/// Top-level document representation. Orchestrates parse → resolve → render.
pub struct Document {
    ref_map: ReferenceMap,
    citations: Vec<Citation>,
    definitions: Vec<Definition>,
    config: DocumentConfig,
}

impl Document {
    /// Parse a complete markdown document.
    pub fn parse(content: &str, config: DocumentConfig) -> Self {
        let registry = ParserRegistry::with_builtins();
        Self::parse_with_registry(content, config, &registry)
    }

    /// Parse with a custom parser registry (for custom types).
    pub fn parse_with_registry(
        content: &str,
        config: DocumentConfig,
        registry: &ParserRegistry,
    ) -> Self {
        let definitions = scan_document(content, &config, registry);
        let ref_map = ReferenceMap::from_definitions(definitions.clone());
        let citations = citation::scan_citations(content);

        Self {
            ref_map,
            citations,
            definitions,
            config,
        }
    }

    /// Resolve all citations to rendered text.
    pub fn resolve_all(&self) -> Vec<ResolvedCitation> {
        renderer::resolve_all(&self.citations, &self.ref_map, &self.config)
    }

    /// Get all definitions found in the document.
    pub fn get_definitions(&self) -> &[Definition] {
        &self.definitions
    }

    /// Resolve definition tags to rendered labels.
    pub fn resolve_definition_tags(&self, content: &str) -> Vec<ResolvedDefinitionTag> {
        let tags = definition_tag::scan_definition_tags(content);
        definition_tag::resolve_definition_tags(&tags, &self.ref_map, &self.config)
    }

    /// Get the reference map for lookups.
    pub fn get_ref_map(&self) -> &ReferenceMap {
        &self.ref_map
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::RefType;

    #[test]
    fn parse_empty_document() {
        let doc = Document::parse("", DocumentConfig::default());
        assert!(doc.get_definitions().is_empty());
        assert!(doc.resolve_all().is_empty());
    }

    #[test]
    fn end_to_end_all_types() {
        let content = "\
# Introduction {#sec:intro}\n\
\n\
![A cat](cat.png){#fig:cat}\n\
\n\
| A | B |\n\
|---|---|\n\
| 1 | 2 |\n\
: Data table {#tbl:data}\n\
\n\
$$E = mc^2$${#eq:einstein}\n\
\n\
```python\n\
print('hello')\n\
```\n\
{#lst:hello}\n\
\n\
See [@fig:cat], [@tbl:data], [@sec:intro], [@eq:einstein], and [@lst:hello].";

        let doc = Document::parse(content, DocumentConfig::default());
        let defs = doc.get_definitions();

        // Should find all 5 types
        assert!(defs.iter().any(|d| d.ref_type == RefType::Sec && d.id == "intro"));
        assert!(defs.iter().any(|d| d.ref_type == RefType::Fig && d.id == "cat"));
        assert!(defs.iter().any(|d| d.ref_type == RefType::Tbl && d.id == "data"));
        assert!(defs.iter().any(|d| d.ref_type == RefType::Eq && d.id == "einstein"));
        assert!(defs.iter().any(|d| d.ref_type == RefType::Lst && d.id == "hello"));

        // Resolve citations
        let resolved = doc.resolve_all();
        assert_eq!(resolved.len(), 5);
        assert!(resolved.iter().all(|r| r.is_valid));
        assert!(resolved.iter().any(|r| r.rendered_text == "Fig. 1"));
        assert!(resolved.iter().any(|r| r.rendered_text == "Table 1"));
        assert!(resolved.iter().any(|r| r.rendered_text == "Section 1"));
        assert!(resolved.iter().any(|r| r.rendered_text == "Eq. 1"));
        assert!(resolved.iter().any(|r| r.rendered_text == "Listing 1"));
    }

    #[test]
    fn end_to_end_batch_references() {
        let content = "\
![A](a.png){#fig:a}\n\
![B](b.png){#fig:b}\n\
![C](c.png){#fig:c}\n\
\n\
See [@fig:a;@fig:b;@fig:c].";

        let doc = Document::parse(content, DocumentConfig::default());
        let resolved = doc.resolve_all();
        assert_eq!(resolved.len(), 1);
        assert!(resolved[0].is_valid);
        assert_eq!(resolved[0].rendered_text, "Figs. 1-3");
    }
}
