use std::collections::hash_map::DefaultHasher;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::collections::VecDeque;

use petgraph::graph::{DiGraph, NodeIndex};
use serde::{Serialize, Deserialize};

use super::knowledge::GraphNode;

const EPSILON: f64 = 1e-10;
const PAR_THRESHOLD_3D: usize = 256;
const SPARSE_THRESHOLD: usize = 1000;
const NEAREST_K: usize = 50;

#[derive(Clone, Debug)]
pub struct Layout3dResult {
    pub positions: HashMap<String, (f64, f64, f64)>,
    pub stress: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Layout3dSettings {
    pub epochs: usize,
    pub epsilon: f64,
    pub random_seed: Option<u64>,
}

impl Default for Layout3dSettings {
    fn default() -> Self {
        Self {
            epochs: 30,
            epsilon: 0.01,
            random_seed: None,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct StressTerm {
    pub i: usize,
    pub j: usize,
    pub d: f64,
    pub w: f64,
}

struct Xorshift64 {
    state: u64,
}

impl Xorshift64 {
    fn new(seed: u64) -> Self {
        let state = if seed == 0 { 1 } else { seed };
        Self { state }
    }

    fn next(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.state = x;
        x
    }

    fn next_bounded(&mut self, n: u64) -> u64 {
        let threshold = n.wrapping_neg() % n;
        loop {
            let x = self.next();
            if x >= threshold {
                return x % n;
            }
        }
    }
}

fn compute_shortest_paths(graph: &DiGraph<GraphNode, ()>) -> (Vec<Vec<u32>>, Vec<NodeIndex>) {
    let indices: Vec<NodeIndex> = graph.node_indices().collect();
    let n = indices.len();
    if n == 0 {
        return (vec![], vec![]);
    }

    let idx_of: HashMap<NodeIndex, usize> = indices.iter().enumerate().map(|(i, &ni)| (ni, i)).collect();

    let mut adj: Vec<Vec<usize>> = vec![vec![]; n];
    let mut seen = HashSet::new();
    for edge in graph.edge_indices() {
        if let Some((s, t)) = graph.edge_endpoints(edge) {
            let si = idx_of[&s];
            let ti = idx_of[&t];
            let key = if si <= ti { (si, ti) } else { (ti, si) };
            if seen.insert(key) {
                adj[si].push(ti);
                adj[ti].push(si);
            }
        }
    }

    let mut dists = vec![vec![u32::MAX; n]; n];

    let bfs_from = |i: usize, row: &mut Vec<u32>| {
        row[i] = 0;
        let mut queue = VecDeque::new();
        queue.push_back(i);
        while let Some(cur) = queue.pop_front() {
            for &neighbor in &adj[cur] {
                if row[neighbor] == u32::MAX {
                    row[neighbor] = row[cur] + 1;
                    queue.push_back(neighbor);
                }
            }
        }
    };

    if n >= PAR_THRESHOLD_3D {
        use rayon::prelude::*;
        dists.par_iter_mut().enumerate().for_each(|(i, row)| {
            bfs_from(i, row);
        });
    } else {
        for i in 0..n {
            bfs_from(i, &mut dists[i]);
        }
    }

    let max_finite: u32 = if n >= PAR_THRESHOLD_3D {
        use rayon::prelude::*;
        dists.par_iter()
            .map(|row| row.iter().filter(|&&d| d != u32::MAX).copied().max().unwrap_or(0))
            .reduce(|| 0, |a, b| a.max(b))
    } else {
        let mut m: u32 = 0;
        for row in &dists {
            for &d in row {
                if d != u32::MAX && d > m {
                    m = d;
                }
            }
        }
        m
    };

    let fallback = if max_finite == 0 { 1 } else { max_finite + 1 };
    if n >= PAR_THRESHOLD_3D {
        use rayon::prelude::*;
        dists.par_iter_mut().for_each(|row| {
            for d in row.iter_mut() {
                if *d == u32::MAX {
                    *d = fallback;
                }
            }
        });
    } else {
        for row in dists.iter_mut() {
            for d in row.iter_mut() {
                if *d == u32::MAX {
                    *d = fallback;
                }
            }
        }
    }

    (dists, indices)
}

/// Build stress terms from the distance matrix.
///
/// For small graphs (n ≤ SPARSE_THRESHOLD) every pair gets a term — stress is exact.
/// For large graphs, only k-nearest-neighbor pairs are included (sparse terms) so
/// the SGD and stress calculation run in O(n·k) instead of O(n²). Reported stress
/// for large graphs is therefore a *partial* metric over the sampled pairs and is
/// not directly comparable to small-graph stress values.
fn build_terms(dists: &[Vec<u32>]) -> Vec<StressTerm> {
    let n = dists.len();
    if n <= SPARSE_THRESHOLD {
        let mut terms = Vec::with_capacity(n * (n - 1) / 2);
        for i in 0..n {
            for j in (i + 1)..n {
                let d = dists[i][j] as f64;
                let w = 1.0 / (d * d);
                terms.push(StressTerm { i, j, d, w });
            }
        }
        return terms;
    }

    let k = NEAREST_K.min(n - 1);
    let mut included: HashSet<(usize, usize)> = HashSet::new();
    for i in 0..n {
        let mut heap: BinaryHeap<(u32, usize)> = BinaryHeap::new();
        for j in 0..n {
            if j == i { continue; }
            let d = dists[i][j];
            if heap.len() < k {
                heap.push((d, j));
            } else if let Some(&(max_d, _)) = heap.peek() {
                if d < max_d {
                    heap.pop();
                    heap.push((d, j));
                }
            }
        }
        for (_, j) in heap {
            let (a, b) = if i < j { (i, j) } else { (j, i) };
            included.insert((a, b));
        }
    }

    let mut terms: Vec<StressTerm> = included.into_iter().map(|(i, j)| {
        let d = dists[i][j] as f64;
        let w = 1.0 / (d * d);
        StressTerm { i, j, d, w }
    }).collect();
    terms.sort_unstable_by(|a, b| (a.i, a.j).cmp(&(b.i, b.j)));
    terms
}

fn compute_schedule(terms: &[StressTerm], epochs: usize, epsilon: f64) -> Vec<f64> {
    if terms.is_empty() || epochs == 0 {
        return vec![];
    }

    let mut w_min = terms[0].w;
    let mut w_max = terms[0].w;
    for t in &terms[1..] {
        if t.w < w_min { w_min = t.w; }
        if t.w > w_max { w_max = t.w; }
    }

    let eta_max = 1.0 / w_min;
    let eta_min = epsilon / w_max;

    if epochs == 1 {
        return vec![eta_max];
    }

    let lambda = (eta_max / eta_min).ln() / (epochs as f64 - 1.0);

    (0..epochs)
        .map(|t| eta_max * (-lambda * t as f64).exp())
        .collect()
}

fn sgd_epoch(pos: &mut [f64], terms: &[StressTerm], eta: f64, rng: &mut Xorshift64) {
    let n = terms.len();
    if n == 0 {
        return;
    }

    let mut indices: Vec<usize> = (0..n).collect();
    for i in (1..n).rev() {
        let j = rng.next_bounded((i + 1) as u64) as usize;
        indices.swap(i, j);
    }

    for &idx in &indices {
        let t = &terms[idx];
        let ix = t.i * 3;
        let jx = t.j * 3;

        let dx = pos[ix] - pos[jx];
        let dy = pos[ix + 1] - pos[jx + 1];
        let dz = pos[ix + 2] - pos[jx + 2];
        let mag = (dx * dx + dy * dy + dz * dz).sqrt();

        if mag < EPSILON {
            continue;
        }

        let mu = (t.w * eta).min(1.0);
        let r = mu * (mag - t.d) / (2.0 * mag);
        let rx = r * dx;
        let ry = r * dy;
        let rz = r * dz;

        pos[ix] -= rx;
        pos[ix + 1] -= ry;
        pos[ix + 2] -= rz;
        pos[jx] += rx;
        pos[jx + 1] += ry;
        pos[jx + 2] += rz;
    }
}

pub fn calculate_stress_3d(pos: &[f64], terms: &[StressTerm]) -> f64 {
    let mut stress = 0.0;
    for t in terms {
        let dx = pos[t.i * 3] - pos[t.j * 3];
        let dy = pos[t.i * 3 + 1] - pos[t.j * 3 + 1];
        let dz = pos[t.i * 3 + 2] - pos[t.j * 3 + 2];
        let dist = (dx * dx + dy * dy + dz * dz).sqrt();
        let stretch = t.d - dist;
        stress += t.w * stretch * stretch;
    }
    stress
}

fn hash_position_3d(id: &str) -> (f64, f64, f64) {
    let mut h1 = DefaultHasher::new();
    id.hash(&mut h1);
    let bits1 = h1.finish();
    let x = ((bits1 & 0xFFFF_FFFF) as f64 / u32::MAX as f64) * 1000.0 - 500.0;
    let y = ((bits1 >> 32) as f64 / u32::MAX as f64) * 1000.0 - 500.0;

    let mut h2 = DefaultHasher::new();
    "z_salt".hash(&mut h2);
    id.hash(&mut h2);
    let bits2 = h2.finish();
    let z = ((bits2 & 0xFFFF_FFFF) as f64 / u32::MAX as f64) * 1000.0 - 500.0;

    (x, y, z)
}

fn derive_seed(graph: &DiGraph<GraphNode, ()>) -> u64 {
    let mut ids: Vec<&str> = graph.node_indices().map(|ni| graph[ni].id.as_str()).collect();
    ids.sort_unstable();
    let mut h = DefaultHasher::new();
    for id in ids {
        id.hash(&mut h);
    }
    let s = h.finish();
    if s == 0 { 1 } else { s }
}

pub fn compute_layout_3d(
    graph: &DiGraph<GraphNode, ()>,
    existing: Option<&HashMap<String, (f64, f64, f64)>>,
    settings: &Layout3dSettings,
) -> Layout3dResult {
    let node_count = graph.node_count();
    if node_count == 0 {
        return Layout3dResult { positions: HashMap::new(), stress: 0.0 };
    }

    let node_indices: Vec<NodeIndex> = graph.node_indices().collect();
    let id_list: Vec<String> = node_indices.iter().map(|&ni| graph[ni].id.clone()).collect();

    let mut pos = vec![0.0_f64; node_count * 3];
    for (i, id) in id_list.iter().enumerate() {
        let (x, y, z) = existing
            .and_then(|m| m.get(id))
            .copied()
            .unwrap_or_else(|| hash_position_3d(id));
        pos[i * 3] = x;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = z;
    }

    let mut stress = 0.0;
    if settings.epochs > 0 && node_count > 1 {
        let (dists, _) = compute_shortest_paths(graph);
        let terms = build_terms(&dists);
        let schedule = compute_schedule(&terms, settings.epochs, settings.epsilon);
        let seed = settings.random_seed.unwrap_or_else(|| derive_seed(graph));
        let mut rng = Xorshift64::new(seed);

        for &eta in &schedule {
            sgd_epoch(&mut pos, &terms, eta, &mut rng);
        }

        stress = calculate_stress_3d(&pos, &terms);
    }

    let positions = id_list
        .into_iter()
        .enumerate()
        .map(|(i, id)| (id, (pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])))
        .collect();

    Layout3dResult { positions, stress }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_graph(ids: &[&str], edges: &[(usize, usize)]) -> DiGraph<GraphNode, ()> {
        let mut g = DiGraph::new();
        let indices: Vec<NodeIndex> = ids
            .iter()
            .map(|id| {
                g.add_node(GraphNode {
                    id: id.to_string(),
                    title: id.to_string(),
                    is_stub: false,
                })
            })
            .collect();
        for &(s, t) in edges {
            g.add_edge(indices[s], indices[t], ());
        }
        g
    }

    // --- Stage 1: Scaffold + Settings ---

    #[test]
    fn settings_default_values() {
        let s = Layout3dSettings::default();
        assert_eq!(s.epochs, 30);
        assert_eq!(s.epsilon, 0.01);
        assert!(s.random_seed.is_none());
    }

    #[test]
    fn settings_is_clone_debug() {
        let s = Layout3dSettings::default();
        let s2 = s.clone();
        assert_eq!(s2.epochs, s.epochs);
        let _ = format!("{:?}", s);
    }

    #[test]
    fn settings_serializes_and_deserializes() {
        let s = Layout3dSettings { epochs: 50, epsilon: 0.05, random_seed: Some(42) };
        let json = serde_json::to_string(&s).unwrap();
        let s2: Layout3dSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(s2.epochs, 50);
        assert_eq!(s2.epsilon, 0.05);
        assert_eq!(s2.random_seed, Some(42));
    }

    #[test]
    fn settings_deserializes_with_null_seed() {
        let json = r#"{"epochs":50,"epsilon":0.05,"random_seed":null}"#;
        let s: Layout3dSettings = serde_json::from_str(json).unwrap();
        assert_eq!(s.epochs, 50);
        assert!(s.random_seed.is_none());
    }

    #[test]
    fn settings_deserializes_from_empty_json() {
        let s: Layout3dSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s.epochs, 30);
        assert_eq!(s.epsilon, 0.01);
        assert!(s.random_seed.is_none());
    }

    #[test]
    fn settings_deserializes_partial_with_defaults() {
        let json = r#"{"epochs":50}"#;
        let s: Layout3dSettings = serde_json::from_str(json).unwrap();
        assert_eq!(s.epochs, 50);
        assert_eq!(s.epsilon, 0.01);
        assert!(s.random_seed.is_none());
    }

    #[test]
    fn stress_term_fields_accessible() {
        let t = StressTerm { i: 0, j: 1, d: 2.0, w: 0.25 };
        assert_eq!(t.i, 0);
        assert_eq!(t.j, 1);
        assert_eq!(t.d, 2.0);
        assert_eq!(t.w, 0.25);
    }

    #[test]
    fn stress_term_is_copy() {
        fn assert_copy<T: Copy>(_: &T) {}
        let t = StressTerm { i: 0, j: 1, d: 1.0, w: 1.0 };
        assert_copy(&t);
    }

    // --- Stage 2: PRNG ---

    #[test]
    fn xorshift64_same_seed_same_sequence() {
        let mut a = Xorshift64::new(42);
        let mut b = Xorshift64::new(42);
        for _ in 0..100 {
            assert_eq!(a.next(), b.next());
        }
    }

    #[test]
    fn xorshift64_different_seeds_differ() {
        let mut a = Xorshift64::new(42);
        let mut b = Xorshift64::new(99);
        let mut same = true;
        for _ in 0..10 {
            if a.next() != b.next() {
                same = false;
                break;
            }
        }
        assert!(!same);
    }

    #[test]
    fn xorshift64_zero_seed_no_fixpoint() {
        let mut rng = Xorshift64::new(0);
        let v = rng.next();
        assert_ne!(v, 0);
    }

    #[test]
    fn xorshift64_next_bounded() {
        let mut rng = Xorshift64::new(123);
        for _ in 0..1000 {
            let v = rng.next_bounded(7);
            assert!(v < 7);
        }
    }

    // --- Stage 3: BFS Shortest Paths ---

    #[test]
    fn shortest_paths_path_graph() {
        let g = make_graph(&["a", "b", "c"], &[(0, 1), (1, 2)]);
        let (dists, indices) = compute_shortest_paths(&g);
        assert_eq!(indices.len(), 3);

        let idx: HashMap<String, usize> = indices.iter().enumerate().map(|(i, &ni)| (g[ni].id.clone(), i)).collect();
        let ai = idx["a"];
        let bi = idx["b"];
        let ci = idx["c"];

        assert_eq!(dists[ai][bi], 1);
        assert_eq!(dists[ai][ci], 2);
        assert_eq!(dists[bi][ci], 1);
        assert_eq!(dists[bi][ai], 1);
        assert_eq!(dists[ci][ai], 2);
    }

    #[test]
    fn shortest_paths_triangle() {
        let g = make_graph(&["a", "b", "c"], &[(0, 1), (1, 2), (0, 2)]);
        let (dists, indices) = compute_shortest_paths(&g);
        let n = indices.len();
        for i in 0..n {
            for j in 0..n {
                if i == j {
                    assert_eq!(dists[i][j], 0);
                } else {
                    assert_eq!(dists[i][j], 1);
                }
            }
        }
    }

    #[test]
    fn shortest_paths_disconnected() {
        let g = make_graph(&["a", "b", "c", "d"], &[(0, 1), (2, 3)]);
        let (dists, indices) = compute_shortest_paths(&g);
        let idx: HashMap<String, usize> = indices.iter().enumerate().map(|(i, &ni)| (g[ni].id.clone(), i)).collect();

        assert_eq!(dists[idx["a"]][idx["b"]], 1);
        assert_eq!(dists[idx["c"]][idx["d"]], 1);

        let cross = dists[idx["a"]][idx["c"]];
        assert_eq!(cross, 2); // diameter(1) + 1
    }

    #[test]
    fn shortest_paths_disconnected_larger_diameter() {
        let g = make_graph(&["a", "b", "c", "d", "e"], &[(0, 1), (1, 2), (3, 4)]);
        let (dists, indices) = compute_shortest_paths(&g);
        let idx: HashMap<String, usize> = indices.iter().enumerate().map(|(i, &ni)| (g[ni].id.clone(), i)).collect();

        assert_eq!(dists[idx["a"]][idx["c"]], 2);
        let cross = dists[idx["a"]][idx["d"]];
        assert_eq!(cross, 3); // diameter(2) + 1
    }

    #[test]
    fn shortest_paths_empty_graph() {
        let g: DiGraph<GraphNode, ()> = DiGraph::new();
        let (dists, indices) = compute_shortest_paths(&g);
        assert!(dists.is_empty());
        assert!(indices.is_empty());
    }

    #[test]
    fn shortest_paths_single_node() {
        let g = make_graph(&["solo"], &[]);
        let (dists, indices) = compute_shortest_paths(&g);
        assert_eq!(indices.len(), 1);
        assert_eq!(dists[0][0], 0);
    }

    // --- Stage 4: Build Terms ---

    #[test]
    fn build_terms_triangle() {
        let g = make_graph(&["a", "b", "c"], &[(0, 1), (1, 2), (0, 2)]);
        let (dists, _) = compute_shortest_paths(&g);
        let terms = build_terms(&dists);
        assert_eq!(terms.len(), 3);
        for t in &terms {
            assert_eq!(t.d, 1.0);
            assert_eq!(t.w, 1.0);
        }
    }

    #[test]
    fn build_terms_path_graph() {
        let g = make_graph(&["a", "b", "c"], &[(0, 1), (1, 2)]);
        let (dists, _) = compute_shortest_paths(&g);
        let terms = build_terms(&dists);
        assert_eq!(terms.len(), 3);

        let long_term = terms.iter().find(|t| t.d == 2.0).unwrap();
        assert!((long_term.w - 0.25).abs() < 1e-10);
    }

    #[test]
    fn build_terms_five_nodes() {
        let g = make_graph(&["a", "b", "c", "d", "e"], &[(0, 1), (1, 2), (2, 3), (3, 4)]);
        let (dists, _) = compute_shortest_paths(&g);
        let terms = build_terms(&dists);
        assert_eq!(terms.len(), 10); // C(5,2)
    }

    #[test]
    fn build_terms_disconnected_no_infinite_weights() {
        let g = make_graph(&["a", "b", "c", "d"], &[(0, 1), (2, 3)]);
        let (dists, _) = compute_shortest_paths(&g);
        let terms = build_terms(&dists);
        for t in &terms {
            assert!(t.w.is_finite());
            assert!(t.w > 0.0);
        }
    }

    // --- Stage 5: Learning Rate Schedule ---

    #[test]
    fn schedule_monotonically_decreasing() {
        let terms = vec![
            StressTerm { i: 0, j: 1, d: 1.0, w: 1.0 },
            StressTerm { i: 0, j: 2, d: 2.0, w: 0.25 },
        ];
        let etas = compute_schedule(&terms, 15, 0.01);
        assert_eq!(etas.len(), 15);
        for i in 1..etas.len() {
            assert!(etas[i] < etas[i - 1], "etas[{}]={} >= etas[{}]={}", i, etas[i], i - 1, etas[i - 1]);
        }
    }

    #[test]
    fn schedule_endpoints() {
        let terms = vec![
            StressTerm { i: 0, j: 1, d: 1.0, w: 1.0 },
            StressTerm { i: 0, j: 2, d: 2.0, w: 0.25 },
        ];
        let eps = 0.01;
        let etas = compute_schedule(&terms, 15, eps);

        let w_min = 0.25;
        let w_max = 1.0;
        let eta_max = 1.0 / w_min;
        let eta_min = eps / w_max;

        assert!((etas[0] - eta_max).abs() < 1e-10);
        assert!((etas[etas.len() - 1] - eta_min).abs() < 1e-10);
    }

    #[test]
    fn schedule_single_term() {
        let terms = vec![StressTerm { i: 0, j: 1, d: 1.0, w: 1.0 }];
        let etas = compute_schedule(&terms, 10, 0.01);
        assert_eq!(etas.len(), 10);
        assert!(etas[0].is_finite());
    }

    #[test]
    fn schedule_one_epoch() {
        let terms = vec![StressTerm { i: 0, j: 1, d: 1.0, w: 0.5 }];
        let etas = compute_schedule(&terms, 1, 0.01);
        assert_eq!(etas.len(), 1);
        assert!((etas[0] - 2.0).abs() < 1e-10); // 1/w_min = 1/0.5 = 2
    }

    // --- Stage 6: SGD Epoch ---

    #[test]
    fn sgd_epoch_coincident_no_nan() {
        let terms = vec![StressTerm { i: 0, j: 1, d: 5.0, w: 1.0 }];
        let mut pos = vec![0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
        let mut rng = Xorshift64::new(42);
        sgd_epoch(&mut pos, &terms, 1.0, &mut rng);
        for &v in &pos {
            assert!(!v.is_nan(), "NaN in position after epoch with coincident nodes");
        }
    }

    #[test]
    fn sgd_epoch_stress_decreases() {
        let terms = vec![StressTerm { i: 0, j: 1, d: 5.0, w: 1.0 / 25.0 }];
        let mut pos = vec![0.0, 0.0, 0.0, 10.0, 0.0, 0.0];
        let stress_before = calculate_stress_3d(&pos, &terms);

        let mut rng = Xorshift64::new(42);
        sgd_epoch(&mut pos, &terms, 1.0 / (1.0 / 25.0), &mut rng);
        let stress_after = calculate_stress_3d(&pos, &terms);

        assert!(
            stress_after < stress_before,
            "stress should decrease: {stress_before} -> {stress_after}"
        );
    }

    #[test]
    fn sgd_epoch_deterministic() {
        let terms = vec![
            StressTerm { i: 0, j: 1, d: 3.0, w: 1.0 / 9.0 },
            StressTerm { i: 0, j: 2, d: 5.0, w: 1.0 / 25.0 },
            StressTerm { i: 1, j: 2, d: 2.0, w: 0.25 },
        ];
        let init = vec![0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0, 5.0, 0.0];

        let mut pos_a = init.clone();
        let mut rng_a = Xorshift64::new(77);
        sgd_epoch(&mut pos_a, &terms, 1.0, &mut rng_a);

        let mut pos_b = init.clone();
        let mut rng_b = Xorshift64::new(77);
        sgd_epoch(&mut pos_b, &terms, 1.0, &mut rng_b);

        assert_eq!(pos_a, pos_b);

        let mut pos_c = init.clone();
        let mut rng_c = Xorshift64::new(999);
        sgd_epoch(&mut pos_c, &terms, 1.0, &mut rng_c);

        assert_ne!(pos_a, pos_c);
    }

    #[test]
    fn calculate_stress_3d_basic() {
        let terms = vec![StressTerm { i: 0, j: 1, d: 5.0, w: 1.0 }];
        let pos = vec![0.0, 0.0, 0.0, 3.0, 4.0, 0.0];
        let stress = calculate_stress_3d(&pos, &terms);
        assert!((stress - 0.0).abs() < 1e-10);

        let pos2 = vec![0.0, 0.0, 0.0, 10.0, 0.0, 0.0];
        let stress2 = calculate_stress_3d(&pos2, &terms);
        assert!((stress2 - 25.0).abs() < 1e-10); // w*(d-mag)^2 = 1*(5-10)^2 = 25
    }

    // --- Stage 7: Entry Point + Integration ---

    #[test]
    fn hash_position_3d_deterministic() {
        let (x1, y1, z1) = hash_position_3d("test_node");
        let (x2, y2, z2) = hash_position_3d("test_node");
        assert_eq!(x1, x2);
        assert_eq!(y1, y2);
        assert_eq!(z1, z2);
    }

    #[test]
    fn hash_position_3d_different_ids_differ() {
        let a = hash_position_3d("alpha");
        let b = hash_position_3d("beta");
        assert_ne!(a, b);
    }

    #[test]
    fn hash_position_3d_in_range() {
        for i in 0..100 {
            let id = format!("node_{i}");
            let (x, y, z) = hash_position_3d(&id);
            assert!((-500.0..=500.0).contains(&x), "x={x} out of range");
            assert!((-500.0..=500.0).contains(&y), "y={y} out of range");
            assert!((-500.0..=500.0).contains(&z), "z={z} out of range");
        }
    }

    #[test]
    fn hash_position_3d_z_independent() {
        let (x, y, z) = hash_position_3d("independence_test");
        assert_ne!(z, x);
        assert_ne!(z, y);
    }

    #[test]
    fn layout_3d_result_is_clone_debug() {
        let r = Layout3dResult { positions: HashMap::new(), stress: 0.0 };
        let r2 = r.clone();
        assert_eq!(r2.stress, 0.0);
        let _ = format!("{:?}", r);
    }

    #[test]
    fn compute_layout_3d_empty_graph() {
        let g: DiGraph<GraphNode, ()> = DiGraph::new();
        let result = compute_layout_3d(&g, None, &Layout3dSettings::default());
        assert!(result.positions.is_empty());
        assert_eq!(result.stress, 0.0);
    }

    #[test]
    fn compute_layout_3d_single_node() {
        let g = make_graph(&["solo"], &[]);
        let result = compute_layout_3d(&g, None, &Layout3dSettings::default());
        assert_eq!(result.positions.len(), 1);
        assert_eq!(result.stress, 0.0);
        let (x, y, z) = result.positions["solo"];
        assert!(x.is_finite());
        assert!(y.is_finite());
        assert!(z.is_finite());
    }

    #[test]
    fn compute_layout_3d_deterministic() {
        let g = make_graph(&["a", "b", "c"], &[(0, 1), (1, 2), (0, 2)]);
        let s = Layout3dSettings { epochs: 20, ..Default::default() };
        let r1 = compute_layout_3d(&g, None, &s);
        let r2 = compute_layout_3d(&g, None, &s);
        for id in ["a", "b", "c"] {
            assert_eq!(r1.positions[id], r2.positions[id], "node {id} differs between runs");
        }
    }

    #[test]
    fn compute_layout_3d_triangle_roughly_equilateral() {
        let g = make_graph(&["a", "b", "c"], &[(0, 1), (1, 2), (0, 2)]);
        let s = Layout3dSettings { epochs: 200, ..Default::default() };
        let r = compute_layout_3d(&g, None, &s);

        let dist = |a: &str, b: &str| {
            let (ax, ay, az) = r.positions[a];
            let (bx, by, bz) = r.positions[b];
            ((ax - bx).powi(2) + (ay - by).powi(2) + (az - bz).powi(2)).sqrt()
        };

        let d01 = dist("a", "b");
        let d12 = dist("b", "c");
        let d02 = dist("a", "c");
        let max_d = d01.max(d12).max(d02);
        let min_d = d01.min(d12).min(d02);
        assert!(
            min_d > 0.0 && max_d / min_d < 1.5,
            "triangle not equilateral: d01={d01:.4}, d12={d12:.4}, d02={d02:.4}"
        );
    }

    #[test]
    fn compute_layout_3d_adjacent_closer() {
        let g = make_graph(&["a", "b", "c", "d"], &[(0, 1), (1, 2), (2, 3)]);
        let s = Layout3dSettings { epochs: 50, ..Default::default() };
        let r = compute_layout_3d(&g, None, &s);

        let dist = |a: &str, b: &str| {
            let (ax, ay, az) = r.positions[a];
            let (bx, by, bz) = r.positions[b];
            ((ax - bx).powi(2) + (ay - by).powi(2) + (az - bz).powi(2)).sqrt()
        };

        let adj_dist = dist("a", "b");
        let far_dist = dist("a", "d");
        assert!(
            adj_dist < far_dist,
            "adjacent should be closer: adj={adj_dist:.4}, far={far_dist:.4}"
        );
    }

    #[test]
    fn compute_layout_3d_disconnected_finite() {
        let g = make_graph(&["a", "b", "c", "d"], &[(0, 1), (2, 3)]);
        let result = compute_layout_3d(&g, None, &Layout3dSettings::default());
        assert_eq!(result.positions.len(), 4);
        for (_, (x, y, z)) in &result.positions {
            assert!(x.is_finite());
            assert!(y.is_finite());
            assert!(z.is_finite());
        }
    }

    #[test]
    fn compute_layout_3d_warm_start_epochs_zero() {
        let g = make_graph(&["a", "b"], &[(0, 1)]);
        let existing: HashMap<String, (f64, f64, f64)> = [
            ("a".into(), (1.0, 2.0, 3.0)),
            ("b".into(), (4.0, 5.0, 6.0)),
        ].into_iter().collect();
        let s = Layout3dSettings { epochs: 0, ..Default::default() };
        let result = compute_layout_3d(&g, Some(&existing), &s);
        assert_eq!(result.positions["a"], (1.0, 2.0, 3.0));
        assert_eq!(result.positions["b"], (4.0, 5.0, 6.0));
        assert_eq!(result.stress, 0.0);
    }

    #[test]
    fn compute_layout_3d_z_has_variance() {
        let g = make_graph(
            &["a", "b", "c", "d", "e"],
            &[(0, 1), (1, 2), (2, 3), (3, 4), (0, 4)],
        );
        let s = Layout3dSettings { epochs: 30, ..Default::default() };
        let r = compute_layout_3d(&g, None, &s);

        let z_vals: Vec<f64> = r.positions.values().map(|&(_, _, z)| z).collect();
        let z_mean = z_vals.iter().sum::<f64>() / z_vals.len() as f64;
        let z_var = z_vals.iter().map(|z| (z - z_mean).powi(2)).sum::<f64>() / z_vals.len() as f64;
        assert!(z_var > 0.0, "z dimension should have nonzero variance, got {z_var}");
    }

    #[test]
    fn compute_layout_3d_seed_override() {
        let g = make_graph(&["a", "b", "c"], &[(0, 1), (1, 2)]);
        let s1 = Layout3dSettings { epochs: 10, random_seed: Some(111), ..Default::default() };
        let s2 = Layout3dSettings { epochs: 10, random_seed: Some(222), ..Default::default() };
        let r1 = compute_layout_3d(&g, None, &s1);
        let r2 = compute_layout_3d(&g, None, &s2);
        assert_ne!(r1.positions["a"], r2.positions["a"], "different seeds should produce different layouts");
    }

    #[test]
    fn compute_layout_3d_all_isolated() {
        let g = make_graph(&["a", "b", "c"], &[]);
        let result = compute_layout_3d(&g, None, &Layout3dSettings::default());
        assert_eq!(result.positions.len(), 3);
        for (_, (x, y, z)) in &result.positions {
            assert!(x.is_finite());
            assert!(y.is_finite());
            assert!(z.is_finite());
        }
    }

    #[test]
    fn compute_layout_3d_reports_nonzero_stress() {
        let g = make_graph(&["a", "b", "c"], &[(0, 1), (1, 2), (0, 2)]);
        let s = Layout3dSettings { epochs: 30, ..Default::default() };
        let result = compute_layout_3d(&g, None, &s);
        assert!(result.stress > 0.0, "stress should be positive for a non-trivial graph");
    }

    #[test]
    fn compute_layout_3d_single_node_zero_stress() {
        let g = make_graph(&["solo"], &[]);
        let result = compute_layout_3d(&g, None, &Layout3dSettings::default());
        assert_eq!(result.stress, 0.0);
    }

    #[test]
    fn shortest_paths_bidirectional_no_duplicates() {
        let mut g = DiGraph::new();
        let a = g.add_node(GraphNode { id: "a".into(), title: "a".into(), is_stub: false });
        let b = g.add_node(GraphNode { id: "b".into(), title: "b".into(), is_stub: false });
        let c = g.add_node(GraphNode { id: "c".into(), title: "c".into(), is_stub: false });
        g.add_edge(a, b, ());
        g.add_edge(b, a, ());
        g.add_edge(b, c, ());
        g.add_edge(c, b, ());

        let (dists, indices) = compute_shortest_paths(&g);
        let idx: HashMap<String, usize> = indices.iter().enumerate()
            .map(|(i, &ni)| (g[ni].id.clone(), i)).collect();

        assert_eq!(dists[idx["a"]][idx["b"]], 1);
        assert_eq!(dists[idx["a"]][idx["c"]], 2);
        assert_eq!(dists[idx["b"]][idx["c"]], 1);
    }

    #[test]
    fn derive_seed_order_independent() {
        let mut g1 = DiGraph::new();
        g1.add_node(GraphNode { id: "alpha".into(), title: "alpha".into(), is_stub: false });
        g1.add_node(GraphNode { id: "beta".into(), title: "beta".into(), is_stub: false });
        g1.add_node(GraphNode { id: "gamma".into(), title: "gamma".into(), is_stub: false });

        let mut g2 = DiGraph::new();
        g2.add_node(GraphNode { id: "gamma".into(), title: "gamma".into(), is_stub: false });
        g2.add_node(GraphNode { id: "alpha".into(), title: "alpha".into(), is_stub: false });
        g2.add_node(GraphNode { id: "beta".into(), title: "beta".into(), is_stub: false });

        assert_eq!(derive_seed(&g1), derive_seed(&g2));
    }

    #[test]
    fn compute_layout_3d_warm_start_uses_existing_positions() {
        let g = make_graph(&["a", "b", "c"], &[(0, 1), (1, 2), (0, 2)]);
        let s = Layout3dSettings { epochs: 10, ..Default::default() };

        let cold = compute_layout_3d(&g, None, &s);

        let custom: HashMap<String, (f64, f64, f64)> = [
            ("a".into(), (100.0, 0.0, 0.0)),
            ("b".into(), (0.0, 100.0, 0.0)),
            ("c".into(), (0.0, 0.0, 100.0)),
        ].into_iter().collect();
        let warm = compute_layout_3d(&g, Some(&custom), &s);

        assert_ne!(cold.positions["a"], warm.positions["a"]);
    }

    // --- Rayon parallel BFS tests ---

    #[test]
    fn shortest_paths_large_graph_parallel() {
        let n = 300;
        let ids: Vec<String> = (0..n).map(|i| format!("n{i}")).collect();
        let id_refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
        let edges: Vec<(usize, usize)> = (0..n - 1).map(|i| (i, i + 1)).collect();
        let g = make_graph(&id_refs, &edges);
        let (dists, indices) = compute_shortest_paths(&g);
        let idx: HashMap<String, usize> = indices.iter().enumerate()
            .map(|(i, &ni)| (g[ni].id.clone(), i)).collect();
        assert_eq!(dists[idx["n0"]][idx["n299"]], 299);
        assert_eq!(dists[idx["n0"]][idx["n0"]], 0);
        assert_eq!(dists[idx["n149"]][idx["n150"]], 1);
    }

    #[test]
    fn shortest_paths_large_disconnected_parallel() {
        let n = 256;
        let ids: Vec<String> = (0..n).map(|i| format!("n{i}")).collect();
        let id_refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
        let mut edges: Vec<(usize, usize)> = Vec::new();
        for i in 0..127 { edges.push((i, i + 1)); }
        for i in 128..255 { edges.push((i, i + 1)); }
        let g = make_graph(&id_refs, &edges);
        let (dists, indices) = compute_shortest_paths(&g);
        let idx: HashMap<String, usize> = indices.iter().enumerate()
            .map(|(i, &ni)| (g[ni].id.clone(), i)).collect();
        assert_eq!(dists[idx["n0"]][idx["n127"]], 127);
        assert_eq!(dists[idx["n128"]][idx["n255"]], 127);
        assert_eq!(dists[idx["n0"]][idx["n128"]], 128);
    }

    #[test]
    #[ignore]
    fn compute_layout_3d_sparse_quality() {
        let n = 1200;
        let ids: Vec<String> = (0..n).map(|i| format!("n{i}")).collect();
        let id_refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
        let mut edges: Vec<(usize, usize)> = Vec::new();
        for i in 0..n - 1 { edges.push((i, i + 1)); }
        let mut rng = Xorshift64::new(42);
        for _ in 0..2000 {
            let a = rng.next_bounded(n as u64) as usize;
            let b = rng.next_bounded(n as u64) as usize;
            if a != b { edges.push((a, b)); }
        }
        let g = make_graph(&id_refs, &edges);
        let s = Layout3dSettings { epochs: 50, ..Default::default() };
        let r = compute_layout_3d(&g, None, &s);

        let dist = |a: &str, b: &str| {
            let (ax, ay, az) = r.positions[a];
            let (bx, by, bz) = r.positions[b];
            ((ax - bx).powi(2) + (ay - by).powi(2) + (az - bz).powi(2)).sqrt()
        };

        let adj_dist = dist("n0", "n1");
        let far_dist = dist("n0", "n600");
        assert!(
            adj_dist < far_dist,
            "adjacent should be closer: adj={adj_dist:.4}, far={far_dist:.4}"
        );
        assert!(r.stress > 0.0, "stress should be positive for a non-trivial graph");
    }

    #[test]
    #[ignore]
    fn layout_3d_10k_under_2s() {
        let n = 10_000;
        let ids: Vec<String> = (0..n).map(|i| format!("n{i}")).collect();
        let id_refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
        let mut edges = Vec::new();
        let mut rng = Xorshift64::new(42);
        for i in 0..n - 1 { edges.push((i, i + 1)); }
        for _ in 0..20_000 {
            let a = rng.next_bounded(n as u64) as usize;
            let b = rng.next_bounded(n as u64) as usize;
            if a != b { edges.push((a, b)); }
        }
        let g = make_graph(&id_refs, &edges);
        let settings = Layout3dSettings::default();
        let start = std::time::Instant::now();
        let _result = compute_layout_3d(&g, None, &settings);
        let elapsed = start.elapsed();
        assert!(
            elapsed < std::time::Duration::from_secs(2),
            "10k layout took {elapsed:?}, expected < 2s"
        );
    }

    #[test]
    #[ignore]
    fn smoke_test_3d_visualize() {
        // --- Build a multi-cluster graph ---
        let mut all_ids: Vec<String> = Vec::new();
        let mut all_edges: Vec<(usize, usize)> = Vec::new();
        let mut cluster_map: Vec<usize> = Vec::new(); // cluster index per node

        let cluster_sizes = [15, 12, 10, 8, 5];
        let mut rng = Xorshift64::new(123);
        let mut offset = 0usize;

        for (ci, &size) in cluster_sizes.iter().enumerate() {
            for i in 0..size {
                all_ids.push(format!("c{ci}_n{i}"));
                cluster_map.push(ci);
            }
            // Ring within cluster
            for i in 0..size {
                all_edges.push((offset + i, offset + (i + 1) % size));
            }
            // Random internal chords
            let extra = size * 2 / 3;
            for _ in 0..extra {
                let a = rng.next_bounded(size as u64) as usize;
                let b = rng.next_bounded(size as u64) as usize;
                if a != b {
                    all_edges.push((offset + a, offset + b));
                }
            }
            offset += size;
        }

        // Bridge edges between clusters
        let bridges = [(0, 1), (1, 2), (2, 3), (3, 4), (0, 3), (1, 4)];
        let mut cum = vec![0usize];
        for &s in &cluster_sizes {
            cum.push(cum.last().unwrap() + s);
        }
        for &(ca, cb) in &bridges {
            let a = cum[ca] + rng.next_bounded(cluster_sizes[ca] as u64) as usize;
            let b = cum[cb] + rng.next_bounded(cluster_sizes[cb] as u64) as usize;
            all_edges.push((a, b));
        }

        // 3 isolated nodes
        for i in 0..3 {
            all_ids.push(format!("isolated_{i}"));
            cluster_map.push(cluster_sizes.len());
        }

        let id_refs: Vec<&str> = all_ids.iter().map(|s| s.as_str()).collect();
        let graph = make_graph(&id_refs, &all_edges);

        // --- Compute 3D layout ---
        let settings = Layout3dSettings {
            epochs: 30,
            epsilon: 0.01,
            random_seed: Some(42),
        };
        let result = compute_layout_3d(&graph, None, &settings);

        // --- Build JSON payload ---
        let nodes_json: Vec<String> = all_ids
            .iter()
            .enumerate()
            .map(|(i, id)| {
                let (x, y, z) = result.positions[id];
                let c = cluster_map[i];
                format!(r#"{{"id":"{}","x":{:.4},"y":{:.4},"z":{:.4},"cluster":{}}}"#, id, x, y, z, c)
            })
            .collect();

        let edges_json: Vec<String> = all_edges
            .iter()
            .map(|&(s, t)| format!(r#"{{"source":"{}","target":"{}"}}"#, all_ids[s], all_ids[t]))
            .collect();

        let data_json = format!(
            r#"{{"nodes":[{}],"edges":[{}],"stress":{:.6},"nodeCount":{},"edgeCount":{}}}"#,
            nodes_json.join(","),
            edges_json.join(","),
            result.stress,
            all_ids.len(),
            all_edges.len(),
        );

        // --- Generate HTML ---
        let html = format!(r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>3D Layout Smoke Test</title>
<style>
  body {{ margin: 0; overflow: hidden; background: #0a0a0f; font-family: system-ui, sans-serif; }}
  #info {{
    position: absolute; top: 12px; left: 12px;
    color: #aab; font-size: 13px; line-height: 1.6;
    background: rgba(10,10,20,0.85); padding: 10px 14px; border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.08);
  }}
  #info b {{ color: #dde; }}
  #tooltip {{
    position: absolute; display: none;
    background: rgba(20,20,40,0.92); color: #fff;
    padding: 5px 10px; border-radius: 4px; font-size: 12px;
    pointer-events: none; border: 1px solid rgba(255,255,255,0.15);
  }}
</style>
</head>
<body>
<div id="info"></div>
<div id="tooltip"></div>
<script type="importmap">
{{
  "imports": {{
    "three": "https://unpkg.com/three@0.164.1/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.164.1/examples/jsm/"
  }}
}}
</script>
<script type="module">
import * as THREE from 'three';
import {{ OrbitControls }} from 'three/addons/controls/OrbitControls.js';

const DATA = {data_json};

const COLORS = [
  0x4fc3f7, // blue
  0xef5350, // red
  0x66bb6a, // green
  0xffa726, // orange
  0xab47bc, // purple
  0x78909c, // grey (isolated)
];

const info = document.getElementById('info');
info.innerHTML = `<b>3D Layout Smoke Test</b><br>`
  + `Nodes: ${{DATA.nodeCount}} &nbsp; Edges: ${{DATA.edgeCount}}<br>`
  + `Stress: ${{DATA.stress.toFixed(4)}}<br>`
  + `<span style="color:#667">drag to orbit · scroll to zoom</span>`;

const tooltip = document.getElementById('tooltip');

// --- Scene setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 10000);
const renderer = new THREE.WebGLRenderer({{ antialias: true }});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;

// --- Compute bounding box and center ---
let cx = 0, cy = 0, cz = 0;
for (const n of DATA.nodes) {{ cx += n.x; cy += n.y; cz += n.z; }}
cx /= DATA.nodes.length; cy /= DATA.nodes.length; cz /= DATA.nodes.length;

let maxR = 0;
for (const n of DATA.nodes) {{
  const r = Math.sqrt((n.x-cx)**2 + (n.y-cy)**2 + (n.z-cz)**2);
  if (r > maxR) maxR = r;
}}
const scale = 100 / Math.max(maxR, 1);

// --- Edges ---
const edgeGeo = new THREE.BufferGeometry();
const edgePositions = [];
const posById = {{}};
for (const n of DATA.nodes) {{
  posById[n.id] = [(n.x-cx)*scale, (n.y-cy)*scale, (n.z-cz)*scale];
}}
for (const e of DATA.edges) {{
  const s = posById[e.source], t = posById[e.target];
  if (s && t) {{ edgePositions.push(...s, ...t); }}
}}
edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
const edgeMat = new THREE.LineBasicMaterial({{ color: 0x334455, transparent: true, opacity: 0.5 }});
scene.add(new THREE.LineSegments(edgeGeo, edgeMat));

// --- Nodes ---
const sphereGeo = new THREE.SphereGeometry(1.2, 16, 12);
const nodeMeshes = [];
for (const n of DATA.nodes) {{
  const color = COLORS[n.cluster % COLORS.length];
  const mat = new THREE.MeshStandardMaterial({{ color, roughness: 0.5, metalness: 0.3 }});
  const mesh = new THREE.Mesh(sphereGeo, mat);
  const p = posById[n.id];
  mesh.position.set(p[0], p[1], p[2]);
  mesh.userData = n;
  scene.add(mesh);
  nodeMeshes.push(mesh);
}}

// --- Lights ---
scene.add(new THREE.AmbientLight(0x445566, 1.5));
const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(50, 80, 60);
scene.add(dir);

// --- Camera ---
camera.position.set(0, 0, 200);
controls.target.set(0, 0, 0);
controls.update();

// --- Hover tooltip via raycasting ---
const raycaster = new THREE.Raycaster();
raycaster.params.Mesh = {{ threshold: 0.5 }};
const mouse = new THREE.Vector2();
let hoveredMesh = null;

renderer.domElement.addEventListener('pointermove', (e) => {{
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(nodeMeshes);
  if (hits.length > 0) {{
    const mesh = hits[0].object;
    if (hoveredMesh !== mesh) {{
      if (hoveredMesh) hoveredMesh.material.emissive.setHex(0);
      hoveredMesh = mesh;
      hoveredMesh.material.emissive.setHex(0x222222);
    }}
    const n = mesh.userData;
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top = (e.clientY - 8) + 'px';
    tooltip.textContent = `${{n.id}}  cluster=${{n.cluster}}  (${{n.x.toFixed(1)}}, ${{n.y.toFixed(1)}}, ${{n.z.toFixed(1)}})`;
  }} else {{
    if (hoveredMesh) {{ hoveredMesh.material.emissive.setHex(0); hoveredMesh = null; }}
    tooltip.style.display = 'none';
  }}
}});

// --- Resize ---
addEventListener('resize', () => {{
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}});

// --- Animate ---
function animate() {{
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}}
animate();
</script>
</body>
</html>"##);

        // --- Write to file ---
        let out_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target");
        std::fs::create_dir_all(&out_dir).unwrap();
        let path = out_dir.join("layout3d_smoke.html");
        std::fs::write(&path, html).unwrap();

        println!("\n=== 3D Layout Smoke Test ===");
        println!("Nodes: {}  Edges: {}", all_ids.len(), all_edges.len());
        println!("Stress: {:.4}", result.stress);
        println!("Written: {}", path.display());
        println!("Open:    open {}", path.display());
    }
}
