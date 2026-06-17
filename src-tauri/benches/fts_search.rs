use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use lit_lib::graph::indexer::GraphIndex;
use lit_lib::graph::store::Store;
use lit_lib::graph::types::{ParsedNode, SearchFilter};
use std::fs;
use tempfile::TempDir;

const ENGLISH_WORDS: &[&str] = &[
    "quantum", "mechanics", "physics", "theory", "particle", "wave",
    "energy", "momentum", "electron", "photon", "field", "force",
    "mass", "velocity", "acceleration", "gravity", "relativity",
    "spacetime", "dimension", "universe", "galaxy", "star", "planet",
    "atom", "molecule", "reaction", "catalyst", "polymer", "crystal",
    "entropy", "thermodynamics", "equilibrium", "oscillation", "frequency",
];

const CJK_PHRASES: &[&str] = &[
    "量子力学", "物理学", "相対性理論", "熱力学", "電磁気学",
    "原子構造", "分子動力学", "波動関数", "粒子物理学", "宇宙論",
];

fn make_body(idx: usize, word_count: usize) -> String {
    let mut body = String::new();
    for i in 0..word_count {
        if i > 0 && i % 15 == 0 {
            body.push('\n');
        } else if i > 0 {
            body.push(' ');
        }
        let word = ENGLISH_WORDS[(idx + i) % ENGLISH_WORDS.len()];
        body.push_str(word);
        if i % 50 == 0 {
            let cjk = CJK_PHRASES[(idx + i) % CJK_PHRASES.len()];
            body.push(' ');
            body.push_str(cjk);
        }
    }
    body
}

fn make_node(idx: usize) -> ParsedNode {
    let body = make_body(idx, 800);
    ParsedNode {
        id: format!("note{idx}.md"),
        title: format!("Note {idx}: {} exploration", ENGLISH_WORDS[idx % ENGLISH_WORDS.len()]),
        tags: vec!["physics".into(), "science".into()],
        frontmatter: serde_json::json!({}),
        first_paragraph: body.lines().next().unwrap_or("").to_string(),
        body,
    }
}

fn setup_store(n: usize) -> Store {
    let store = Store::open_memory().unwrap();
    for i in 0..n {
        let node = make_node(i);
        store.upsert_node(&node, i as i64, Some(&node.body)).unwrap();
    }
    store
}

fn setup_workspace(n: usize) -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join(".lit")).unwrap();
    for i in 0..n {
        let node = make_node(i);
        let content = format!("---\ntitle: {}\ntags: [physics, science]\n---\n{}", node.title, node.body);
        fs::write(dir.path().join(&node.id), content).unwrap();
    }
    dir
}

fn bench_fts_english(c: &mut Criterion) {
    let mut group = c.benchmark_group("fts_english");
    for &n in &[100, 1000, 5000, 10000] {
        let store = setup_store(n);
        group.bench_with_input(BenchmarkId::new("search_content", n), &n, |b, _| {
            b.iter(|| store.search_content("quantum mechanics", 20).unwrap());
        });
    }
    group.finish();
}

fn bench_fts_cjk(c: &mut Criterion) {
    let mut group = c.benchmark_group("fts_cjk");
    for &n in &[100, 1000, 5000, 10000] {
        let store = setup_store(n);
        group.bench_with_input(BenchmarkId::new("search_content", n), &n, |b, _| {
            b.iter(|| store.search_content("量子力学", 20).unwrap());
        });
    }
    group.finish();
}

fn bench_fts_filtered(c: &mut Criterion) {
    let mut group = c.benchmark_group("fts_filtered");
    for &n in &[100, 1000, 5000, 10000] {
        let store = setup_store(n);
        group.bench_with_input(BenchmarkId::new("search_content_filtered", n), &n, |b, _| {
            b.iter(|| store.search_content_filtered("quantum", &SearchFilter::default(), 100).unwrap());
        });
    }
    group.finish();
}

fn bench_fts_vs_ripgrep(c: &mut Criterion) {
    let mut group = c.benchmark_group("fts_vs_ripgrep");
    group.sample_size(10);
    for &n in &[100, 1000, 5000] {
        let dir = setup_workspace(n);
        let gi = GraphIndex::build(dir.path().to_path_buf(), false).unwrap();

        group.bench_with_input(BenchmarkId::new("fts", n), &n, |b, _| {
            b.iter(|| gi.search_content("quantum mechanics", 20).unwrap());
        });
        group.bench_with_input(BenchmarkId::new("ripgrep", n), &n, |b, _| {
            b.iter(|| gi.search("quantum mechanics", 20).unwrap());
        });
    }
    group.finish();
}

fn bench_index_size(c: &mut Criterion) {
    let mut group = c.benchmark_group("index_size");
    group.sample_size(10);
    for &n in &[100, 1000, 5000, 10000] {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("graph.db");
        let store = Store::open(&db_path).unwrap();
        for i in 0..n {
            let node = make_node(i);
            store.upsert_node(&node, i as i64, Some(&node.body)).unwrap();
        }
        let size = fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
        let size_mb = size as f64 / (1024.0 * 1024.0);
        println!("index_size: {n} notes = {size_mb:.2} MB ({size} bytes)");

        group.bench_with_input(BenchmarkId::new("query_after_populate", n), &n, |b, _| {
            b.iter(|| store.search_content("quantum mechanics", 20).unwrap());
        });
    }
    group.finish();
}

criterion_group!(
    benches,
    bench_fts_english,
    bench_fts_cjk,
    bench_fts_filtered,
    bench_fts_vs_ripgrep,
    bench_index_size,
);
criterion_main!(benches);
