use std::time::Duration;

use criterion::{criterion_group, criterion_main, Criterion};
use petgraph::graph::DiGraph;
use rand::Rng;

use lit_lib::graph::knowledge::GraphNode;
use lit_lib::graph::layout3d::{Layout3dSettings, compute_layout_3d};

fn make_random_graph(n: usize, m: usize, seed: u64) -> DiGraph<GraphNode, ()> {
    use rand::SeedableRng;
    let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
    let mut g = DiGraph::new();
    let indices: Vec<_> = (0..n)
        .map(|i| {
            g.add_node(GraphNode {
                id: format!("n{i}"),
                title: format!("n{i}"),
                is_stub: false,
            })
        })
        .collect();
    for _ in 0..m {
        let a = rng.gen_range(0..n);
        let b = rng.gen_range(0..n);
        if a != b {
            g.add_edge(indices[a], indices[b], ());
        }
    }
    g
}

fn layout3d_1k(c: &mut Criterion) {
    let g = make_random_graph(1_000, 3_000, 42);
    let settings = Layout3dSettings::default();
    c.bench_function("layout3d_1k", |b| {
        b.iter(|| compute_layout_3d(&g, None, &settings))
    });
}

fn layout3d_5k(c: &mut Criterion) {
    let g = make_random_graph(5_000, 15_000, 42);
    let settings = Layout3dSettings::default();
    let mut group = c.benchmark_group("layout3d_5k");
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(20));
    group.bench_function("layout3d_5k", |b| {
        b.iter(|| compute_layout_3d(&g, None, &settings))
    });
    group.finish();
}

fn layout3d_10k(c: &mut Criterion) {
    let g = make_random_graph(10_000, 30_000, 42);
    let settings = Layout3dSettings::default();
    let mut group = c.benchmark_group("layout3d_10k");
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(30));
    group.bench_function("layout3d_10k", |b| {
        b.iter(|| compute_layout_3d(&g, None, &settings))
    });
    group.finish();
}

criterion_group!(benches, layout3d_1k, layout3d_5k, layout3d_10k);
criterion_main!(benches);
