use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::collections::VecDeque;

use petgraph::graph::{DiGraph, NodeIndex};

use super::knowledge::GraphNode;

const EPSILON: f64 = 1e-10;

#[derive(Clone, Debug)]
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
        self.next() % n
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
    for edge in graph.edge_indices() {
        if let Some((s, t)) = graph.edge_endpoints(edge) {
            let si = idx_of[&s];
            let ti = idx_of[&t];
            adj[si].push(ti);
            adj[ti].push(si);
        }
    }

    let mut dists = vec![vec![u32::MAX; n]; n];
    for i in 0..n {
        dists[i][i] = 0;
        let mut queue = VecDeque::new();
        queue.push_back(i);
        while let Some(cur) = queue.pop_front() {
            for &neighbor in &adj[cur] {
                if dists[i][neighbor] == u32::MAX {
                    dists[i][neighbor] = dists[i][cur] + 1;
                    queue.push_back(neighbor);
                }
            }
        }
    }

    let mut max_finite: u32 = 0;
    for row in &dists {
        for &d in row {
            if d != u32::MAX && d > max_finite {
                max_finite = d;
            }
        }
    }

    let fallback = if max_finite == 0 { 1 } else { max_finite + 1 };
    for row in dists.iter_mut() {
        for d in row.iter_mut() {
            if *d == u32::MAX {
                *d = fallback;
            }
        }
    }

    (dists, indices)
}

fn build_terms(dists: &[Vec<u32>]) -> Vec<StressTerm> {
    let n = dists.len();
    let mut terms = Vec::with_capacity(n * (n - 1) / 2);
    for i in 0..n {
        for j in (i + 1)..n {
            let d = dists[i][j] as f64;
            let w = 1.0 / (d * d);
            terms.push(StressTerm { i, j, d, w });
        }
    }
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
    let mut h = DefaultHasher::new();
    for ni in graph.node_indices() {
        graph[ni].id.hash(&mut h);
    }
    let s = h.finish();
    if s == 0 { 1 } else { s }
}

pub fn compute_layout_3d(
    graph: &DiGraph<GraphNode, ()>,
    existing: Option<&HashMap<String, (f64, f64, f64)>>,
    settings: &Layout3dSettings,
) -> HashMap<String, (f64, f64, f64)> {
    let node_count = graph.node_count();
    if node_count == 0 {
        return HashMap::new();
    }

    let (dists, node_indices) = compute_shortest_paths(graph);

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

    if settings.epochs > 0 && node_count > 1 {
        let terms = build_terms(&dists);
        let schedule = compute_schedule(&terms, settings.epochs, settings.epsilon);
        let seed = settings.random_seed.unwrap_or_else(|| derive_seed(graph));
        let mut rng = Xorshift64::new(seed);

        for &eta in &schedule {
            sgd_epoch(&mut pos, &terms, eta, &mut rng);
        }
    }

    id_list
        .into_iter()
        .enumerate()
        .map(|(i, id)| (id, (pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])))
        .collect()
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
    fn compute_layout_3d_empty_graph() {
        let g: DiGraph<GraphNode, ()> = DiGraph::new();
        let result = compute_layout_3d(&g, None, &Layout3dSettings::default());
        assert!(result.is_empty());
    }

    #[test]
    fn compute_layout_3d_single_node() {
        let g = make_graph(&["solo"], &[]);
        let result = compute_layout_3d(&g, None, &Layout3dSettings::default());
        assert_eq!(result.len(), 1);
        let (x, y, z) = result["solo"];
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
            assert_eq!(r1[id], r2[id], "node {id} differs between runs");
        }
    }

    #[test]
    fn compute_layout_3d_triangle_roughly_equilateral() {
        let g = make_graph(&["a", "b", "c"], &[(0, 1), (1, 2), (0, 2)]);
        let s = Layout3dSettings { epochs: 200, ..Default::default() };
        let r = compute_layout_3d(&g, None, &s);

        let dist = |a: &str, b: &str| {
            let (ax, ay, az) = r[a];
            let (bx, by, bz) = r[b];
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
            let (ax, ay, az) = r[a];
            let (bx, by, bz) = r[b];
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
        assert_eq!(result.len(), 4);
        for (_, (x, y, z)) in &result {
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
        assert_eq!(result["a"], (1.0, 2.0, 3.0));
        assert_eq!(result["b"], (4.0, 5.0, 6.0));
    }

    #[test]
    fn compute_layout_3d_z_has_variance() {
        let g = make_graph(
            &["a", "b", "c", "d", "e"],
            &[(0, 1), (1, 2), (2, 3), (3, 4), (0, 4)],
        );
        let s = Layout3dSettings { epochs: 30, ..Default::default() };
        let r = compute_layout_3d(&g, None, &s);

        let z_vals: Vec<f64> = r.values().map(|&(_, _, z)| z).collect();
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
        assert_ne!(r1["a"], r2["a"], "different seeds should produce different layouts");
    }

    #[test]
    fn compute_layout_3d_all_isolated() {
        let g = make_graph(&["a", "b", "c"], &[]);
        let result = compute_layout_3d(&g, None, &Layout3dSettings::default());
        assert_eq!(result.len(), 3);
        for (_, (x, y, z)) in &result {
            assert!(x.is_finite());
            assert!(y.is_finite());
            assert!(z.is_finite());
        }
    }
}
