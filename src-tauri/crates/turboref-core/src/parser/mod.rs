pub mod scan;
pub mod figure;
pub mod table;
pub mod section;
pub mod equation;
pub mod listing;

use crate::config::DocumentConfig;
use crate::types::{Definition, RefType};
use scan::ScanContext;

/// State for sub-figure block accumulation.
#[derive(Debug, Default, Clone)]
pub struct SubFigState {
    pub active: bool,
    pub main_id: String,
    pub main_number: u32,
    pub current_count: u32,
    pub accumulated_lines: Vec<String>,
}

/// Pending image awaiting a next-line `{#fig:id}` tag (used inside `<div>` blocks).
#[derive(Debug, Default, Clone)]
pub struct PendingFigure {
    pub active: bool,
    pub description: String,
    pub line: usize,
    pub char_offset: usize,
}

/// A single image line waiting to be finalized (used outside `<div>` blocks).
#[derive(Debug, Clone)]
pub struct PendingImage {
    pub description: String,
    pub id: Option<String>,
    pub line: usize,
    pub char_offset: usize,
}

/// Accumulates consecutive image lines for caption-based sub-figure detection.
#[derive(Debug, Default, Clone)]
pub struct ImageAccumulator {
    pub images: Vec<PendingImage>,
    pub awaiting_tag: bool,
}

/// Mutable counters shared across parsers during a single-pass scan.
#[derive(Debug, Default)]
pub struct Counters {
    pub fig_count: u32,
    pub tbl_count: u32,
    pub eq_count: u32,
    pub lst_count: u32,
    pub sec_levels: [u32; 6],
    pub sub_fig: SubFigState,
    pub pending_fig: PendingFigure,
    pub image_acc: ImageAccumulator,
}

/// Trait for definition parsers. Each reference type implements this.
pub trait DefinitionParser: Send + Sync {
    /// The reference type this parser handles.
    fn ref_type(&self) -> RefType;

    /// The prefix string used in markdown (e.g., "fig", "eq").
    fn prefix_str(&self) -> &str;

    /// Process a single line during the scan. Returns any definitions found.
    fn on_line(
        &self,
        line: &str,
        line_idx: usize,
        char_offset: usize,
        ctx: &ScanContext,
        counters: &mut Counters,
        config: &DocumentConfig,
    ) -> Vec<Definition>;

    /// Called after all lines have been processed. Flush any pending state.
    fn on_end(&self, _counters: &mut Counters) -> Vec<Definition> {
        Vec::new()
    }
}

/// Registry holding all active parsers.
pub struct ParserRegistry {
    parsers: Vec<Box<dyn DefinitionParser>>,
}

impl ParserRegistry {
    pub fn new() -> Self {
        Self {
            parsers: Vec::new(),
        }
    }

    /// Create a registry with all built-in parsers.
    pub fn with_builtins() -> Self {
        let mut registry = Self::new();
        registry.register(Box::new(figure::FigureParser));
        registry.register(Box::new(table::TableParser));
        registry.register(Box::new(section::SectionParser));
        registry.register(Box::new(equation::EquationParser::new()));
        registry.register(Box::new(listing::ListingParser::new()));
        registry
    }

    pub fn register(&mut self, parser: Box<dyn DefinitionParser>) {
        self.parsers.push(parser);
    }

    pub fn parsers(&self) -> &[Box<dyn DefinitionParser>] {
        &self.parsers
    }
}

impl Default for ParserRegistry {
    fn default() -> Self {
        Self::with_builtins()
    }
}
