// Throwaway benchmark: measures GraphIndex::build + reindex_file (the write_page
// hot path) against a workspace path given as argv[1].
//
//   cargo run --release --example bench_reindex -- /tmp/lit-bench-ws path/to/note.md

use std::time::Instant;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter("lit_lib=info")
        .init();

    let mut args = std::env::args().skip(1);
    let workspace = std::path::PathBuf::from(args.next().expect("usage: bench_reindex <workspace> <relative-note.md>"));
    let note = args.next().expect("usage: bench_reindex <workspace> <relative-note.md>");

    let t = Instant::now();
    let gi = lit_lib::graph::indexer::GraphIndex::build(workspace, &lit_lib::annotation::lang::AnnotationIndexOpts::disabled()).expect("build failed");
    println!("build: {:?}", t.elapsed());

    for i in 0..5 {
        let t = Instant::now();
        gi.reindex_file(&note, &lit_lib::annotation::lang::AnnotationIndexOpts::disabled()).expect("reindex failed");
        println!("reindex_file #{i}: {:?}", t.elapsed());
    }
}
