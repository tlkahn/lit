use std::collections::{HashMap, HashSet, VecDeque};

use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::Direction;
use serde::{Deserialize, Serialize};

use super::error::GraphError;
use super::store::Store;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    pub is_stub: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SubgraphResult {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<(String, String)>,
}

pub struct KnowledgeGraph {
    graph: DiGraph<GraphNode, ()>,
    id_to_index: HashMap<String, NodeIndex>,
}

impl KnowledgeGraph {
    pub fn from_store(store: &Store) -> Result<Self, GraphError> {
        let nodes_meta = store.all_nodes_metadata()?;
        let titles = store.node_titles()?;
        let store_edges = store.all_edges()?;

        let mut graph = DiGraph::new();
        let mut id_to_index = HashMap::new();

        for (id, is_stub) in &nodes_meta {
            let title = titles.get(id).cloned().unwrap_or_default();
            let node = GraphNode {
                id: id.clone(),
                title,
                is_stub: *is_stub,
            };
            let idx = graph.add_node(node);
            id_to_index.insert(id.clone(), idx);
        }

        let mut seen_edges = HashSet::new();
        for (source, target) in &store_edges {
            if let (Some(&s_idx), Some(&t_idx)) =
                (id_to_index.get(source), id_to_index.get(target))
            {
                if seen_edges.insert((s_idx, t_idx)) {
                    graph.add_edge(s_idx, t_idx, ());
                }
            }
        }

        Ok(Self { graph, id_to_index })
    }

    pub fn graph_clone(&self) -> DiGraph<GraphNode, ()> {
        self.graph.clone()
    }

    pub fn full_subgraph(&self) -> SubgraphResult {
        let nodes: Vec<GraphNode> = self.graph.node_weights().cloned().collect();
        let edges: Vec<(String, String)> = self
            .graph
            .edge_indices()
            .filter_map(|e| {
                let (s, t) = self.graph.edge_endpoints(e)?;
                Some((self.graph[s].id.clone(), self.graph[t].id.clone()))
            })
            .collect();
        SubgraphResult { nodes, edges }
    }

    pub fn neighbors(
        &self,
        id: &str,
        depth: usize,
        directed: bool,
    ) -> Result<SubgraphResult, GraphError> {
        let &start = self
            .id_to_index
            .get(id)
            .ok_or_else(|| GraphError::NodeNotFound { id: id.into() })?;
        let visited = self.bfs_collect(&[start], depth, directed);
        Ok(self.induced_subgraph(&visited))
    }

    pub fn shared(
        &self,
        a: &str,
        b: &str,
        directed: bool,
    ) -> Result<Vec<GraphNode>, GraphError> {
        let &idx_a = self
            .id_to_index
            .get(a)
            .ok_or_else(|| GraphError::NodeNotFound { id: a.into() })?;
        let &idx_b = self
            .id_to_index
            .get(b)
            .ok_or_else(|| GraphError::NodeNotFound { id: b.into() })?;

        let na = self.immediate_neighbors(idx_a, directed);
        let nb = self.immediate_neighbors(idx_b, directed);

        let common: Vec<GraphNode> = na
            .intersection(&nb)
            .copied()
            .filter(|&idx| idx != idx_a && idx != idx_b)
            .map(|idx| self.graph[idx].clone())
            .collect();

        Ok(common)
    }

    pub fn paths(
        &self,
        from: &str,
        to: &str,
        max_depth: usize,
        directed: bool,
    ) -> Result<Vec<Vec<String>>, GraphError> {
        let &start = self
            .id_to_index
            .get(from)
            .ok_or_else(|| GraphError::NodeNotFound { id: from.into() })?;
        let &end = self
            .id_to_index
            .get(to)
            .ok_or_else(|| GraphError::NodeNotFound { id: to.into() })?;

        if start == end {
            return Ok(vec![]);
        }

        let mut results = Vec::new();
        let mut visited = HashSet::new();
        visited.insert(start);
        let mut path = vec![start];

        self.dfs_paths(
            start,
            end,
            max_depth,
            directed,
            &mut visited,
            &mut path,
            &mut results,
        );

        Ok(results)
    }

    pub fn subgraph(
        &self,
        seeds: &[&str],
        depth: usize,
        directed: bool,
    ) -> Result<SubgraphResult, GraphError> {
        if seeds.is_empty() {
            return Ok(self.full_subgraph());
        }
        let mut seed_indices = Vec::new();
        for &seed_id in seeds {
            let &idx = self
                .id_to_index
                .get(seed_id)
                .ok_or_else(|| GraphError::NodeNotFound {
                    id: seed_id.into(),
                })?;
            seed_indices.push(idx);
        }

        let visited = self.bfs_collect(&seed_indices, depth, directed);
        Ok(self.induced_subgraph(&visited))
    }

    fn bfs_collect(
        &self,
        seeds: &[NodeIndex],
        depth: usize,
        directed: bool,
    ) -> HashSet<NodeIndex> {
        let mut visited = HashSet::new();
        let mut queue = VecDeque::new();

        for &seed in seeds {
            if visited.insert(seed) {
                queue.push_back((seed, 0));
            }
        }

        while let Some((node, level)) = queue.pop_front() {
            if level >= depth {
                continue;
            }

            for neighbor in self.graph.neighbors_directed(node, Direction::Outgoing) {
                if visited.insert(neighbor) {
                    queue.push_back((neighbor, level + 1));
                }
            }
            if !directed {
                for neighbor in self.graph.neighbors_directed(node, Direction::Incoming) {
                    if visited.insert(neighbor) {
                        queue.push_back((neighbor, level + 1));
                    }
                }
            }
        }

        visited
    }

    fn immediate_neighbors(&self, node: NodeIndex, directed: bool) -> HashSet<NodeIndex> {
        let mut set: HashSet<NodeIndex> =
            self.graph.neighbors_directed(node, Direction::Outgoing).collect();
        if !directed {
            set.extend(self.graph.neighbors_directed(node, Direction::Incoming));
        }
        set
    }

    fn induced_subgraph(&self, visited: &HashSet<NodeIndex>) -> SubgraphResult {
        let nodes: Vec<GraphNode> = visited.iter().map(|&idx| self.graph[idx].clone()).collect();

        let edges: Vec<(String, String)> = self
            .graph
            .edge_indices()
            .filter_map(|e| {
                let (s, t) = self.graph.edge_endpoints(e)?;
                if visited.contains(&s) && visited.contains(&t) {
                    Some((self.graph[s].id.clone(), self.graph[t].id.clone()))
                } else {
                    None
                }
            })
            .collect();

        SubgraphResult { nodes, edges }
    }

    pub fn pagerank(&self, damping: f64) -> HashMap<String, f64> {
        let n = self.graph.node_count();
        if n == 0 {
            return HashMap::new();
        }

        let node_indices: Vec<NodeIndex> = self.graph.node_indices().collect();
        let index_to_pos: HashMap<NodeIndex, usize> = node_indices
            .iter()
            .enumerate()
            .map(|(pos, &idx)| (idx, pos))
            .collect();

        let n_f = n as f64;
        let mut scores = vec![1.0 / n_f; n];
        let mut new_scores = vec![0.0; n];

        let out_degrees: Vec<usize> = node_indices
            .iter()
            .map(|&idx| self.graph.neighbors_directed(idx, Direction::Outgoing).count())
            .collect();

        for _ in 0..100 {
            let dangling_sum: f64 = node_indices
                .iter()
                .enumerate()
                .filter(|&(pos, _)| out_degrees[pos] == 0)
                .map(|(pos, _)| scores[pos])
                .sum();

            for (j, _) in node_indices.iter().enumerate() {
                let mut incoming_sum = 0.0;
                for neighbor in self.graph.neighbors_directed(node_indices[j], Direction::Incoming) {
                    let pos = index_to_pos[&neighbor];
                    incoming_sum += scores[pos] / out_degrees[pos] as f64;
                }
                new_scores[j] =
                    (1.0 - damping) / n_f + damping * (dangling_sum / n_f + incoming_sum);
            }

            let max_delta = scores
                .iter()
                .zip(new_scores.iter())
                .map(|(old, new)| (old - new).abs())
                .fold(0.0_f64, f64::max);

            std::mem::swap(&mut scores, &mut new_scores);

            if max_delta < 1e-6 {
                break;
            }
        }

        let total: f64 = scores.iter().sum();
        if total > 0.0 {
            for s in &mut scores {
                *s /= total;
            }
        }

        node_indices
            .iter()
            .enumerate()
            .map(|(pos, &idx)| (self.graph[idx].id.clone(), scores[pos]))
            .collect()
    }

    fn dfs_paths(
        &self,
        current: NodeIndex,
        target: NodeIndex,
        max_depth: usize,
        directed: bool,
        visited: &mut HashSet<NodeIndex>,
        path: &mut Vec<NodeIndex>,
        results: &mut Vec<Vec<String>>,
    ) {
        if path.len() - 1 >= max_depth {
            return;
        }

        let mut neighbors: HashSet<NodeIndex> =
            self.graph.neighbors_directed(current, Direction::Outgoing).collect();
        if !directed {
            neighbors.extend(self.graph.neighbors_directed(current, Direction::Incoming));
        }

        for neighbor in neighbors {
            if neighbor == target {
                path.push(neighbor);
                results.push(path.iter().map(|&idx| self.graph[idx].id.clone()).collect());
                path.pop();
            } else if visited.insert(neighbor) {
                path.push(neighbor);
                self.dfs_paths(neighbor, target, max_depth, directed, visited, path, results);
                path.pop();
                visited.remove(&neighbor);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::types::ParsedNode;
    use std::collections::HashSet;

    fn make_node(id: &str, title: &str) -> ParsedNode {
        ParsedNode {
            id: id.into(),
            title: title.into(),
            tags: vec![],
            frontmatter: serde_json::json!({}),
            first_paragraph: String::new(),
        }
    }

    /// Test fixture: A-->B-->C, A-->D, A-->F(stub), B-->D, E(isolated)
    fn build_test_graph() -> (Store, KnowledgeGraph) {
        let store = Store::open_memory().unwrap();
        store.upsert_node(&make_node("A", "Alpha"), 1).unwrap();
        store.upsert_node(&make_node("B", "Beta"), 1).unwrap();
        store.upsert_node(&make_node("C", "Charlie"), 1).unwrap();
        store.upsert_node(&make_node("D", "Delta"), 1).unwrap();
        store.upsert_node(&make_node("E", "Echo"), 1).unwrap();
        store.upsert_stub("F").unwrap();

        store.insert_edge("A", "B", "", "", 0).unwrap();
        store.insert_edge("B", "C", "", "", 0).unwrap();
        store.insert_edge("A", "D", "", "", 0).unwrap();
        store.insert_edge("A", "F", "", "", 0).unwrap();
        store.insert_edge("B", "D", "", "", 0).unwrap();

        let kg = KnowledgeGraph::from_store(&store).unwrap();
        (store, kg)
    }

    // --- Step 1: types ---

    #[test]
    fn graph_node_serialization_round_trip() {
        let node = GraphNode {
            id: "test".into(),
            title: "Test".into(),
            is_stub: false,
        };
        let json = serde_json::to_string(&node).unwrap();
        let deserialized: GraphNode = serde_json::from_str(&json).unwrap();
        assert_eq!(node, deserialized);
    }

    #[test]
    fn graph_node_clone_eq() {
        let node = GraphNode {
            id: "test".into(),
            title: "Test".into(),
            is_stub: true,
        };
        let cloned = node.clone();
        assert_eq!(node, cloned);
    }

    #[test]
    fn subgraph_result_empty() {
        let result = SubgraphResult {
            nodes: vec![],
            edges: vec![],
        };
        assert!(result.nodes.is_empty());
        assert!(result.edges.is_empty());
    }

    #[test]
    fn subgraph_result_serialization_round_trip() {
        let result = SubgraphResult {
            nodes: vec![GraphNode {
                id: "a".into(),
                title: "A".into(),
                is_stub: false,
            }],
            edges: vec![("a".into(), "b".into())],
        };
        let json = serde_json::to_string(&result).unwrap();
        let deserialized: SubgraphResult = serde_json::from_str(&json).unwrap();
        assert_eq!(result, deserialized);
    }

    // --- Step 2: from_store ---

    #[test]
    fn from_store_node_count() {
        let (_, kg) = build_test_graph();
        assert_eq!(kg.graph.node_count(), 6);
    }

    #[test]
    fn from_store_edge_count() {
        let (_, kg) = build_test_graph();
        assert_eq!(kg.graph.edge_count(), 5);
    }

    #[test]
    fn from_store_id_mapping() {
        let (_, kg) = build_test_graph();
        assert!(kg.id_to_index.contains_key("A"));
        assert!(kg.id_to_index.contains_key("F"));
        assert!(!kg.id_to_index.contains_key("Z"));
    }

    #[test]
    fn from_store_title_preservation() {
        let (_, kg) = build_test_graph();
        let idx = kg.id_to_index["A"];
        assert_eq!(kg.graph[idx].title, "Alpha");
    }

    #[test]
    fn from_store_stub_flag() {
        let (_, kg) = build_test_graph();
        let idx_f = kg.id_to_index["F"];
        assert!(kg.graph[idx_f].is_stub);
        let idx_a = kg.id_to_index["A"];
        assert!(!kg.graph[idx_a].is_stub);
    }

    #[test]
    fn from_store_empty() {
        let store = Store::open_memory().unwrap();
        let kg = KnowledgeGraph::from_store(&store).unwrap();
        assert_eq!(kg.graph.node_count(), 0);
        assert_eq!(kg.graph.edge_count(), 0);
    }

    #[test]
    fn from_store_duplicate_edges() {
        let store = Store::open_memory().unwrap();
        store.upsert_node(&make_node("A", "A"), 1).unwrap();
        store.upsert_node(&make_node("B", "B"), 1).unwrap();
        store.insert_edge("A", "B", "ctx1", "", 0).unwrap();
        store.insert_edge("A", "B", "ctx2", "", 0).unwrap();
        let kg = KnowledgeGraph::from_store(&store).unwrap();
        assert_eq!(kg.graph.edge_count(), 1);
    }

    // --- Step 3: full_subgraph ---

    #[test]
    fn full_subgraph_all_nodes() {
        let (_, kg) = build_test_graph();
        let result = kg.full_subgraph();
        assert_eq!(result.nodes.len(), 6);
        let ids: HashSet<&str> = result.nodes.iter().map(|n| n.id.as_str()).collect();
        assert!(ids.contains("A"));
        assert!(ids.contains("E"));
        assert!(ids.contains("F"));
    }

    #[test]
    fn full_subgraph_all_edges() {
        let (_, kg) = build_test_graph();
        let result = kg.full_subgraph();
        assert_eq!(result.edges.len(), 5);
    }

    #[test]
    fn full_subgraph_empty_graph() {
        let store = Store::open_memory().unwrap();
        let kg = KnowledgeGraph::from_store(&store).unwrap();
        let result = kg.full_subgraph();
        assert!(result.nodes.is_empty());
        assert!(result.edges.is_empty());
    }

    #[test]
    fn full_subgraph_edge_ids_are_strings() {
        let (_, kg) = build_test_graph();
        let result = kg.full_subgraph();
        let edge_set: HashSet<(&str, &str)> = result
            .edges
            .iter()
            .map(|(s, t)| (s.as_str(), t.as_str()))
            .collect();
        assert!(edge_set.contains(&("A", "B")));
        assert!(edge_set.contains(&("B", "C")));
    }

    // --- Step 4: neighbors ---

    #[test]
    fn neighbors_depth_0_seed_only() {
        let (_, kg) = build_test_graph();
        let result = kg.neighbors("E", 0, true).unwrap();
        assert_eq!(result.nodes.len(), 1);
        assert_eq!(result.nodes[0].id, "E");
        assert!(result.edges.is_empty());
    }

    #[test]
    fn neighbors_depth_1_directed() {
        let (_, kg) = build_test_graph();
        let result = kg.neighbors("A", 1, true).unwrap();
        let ids: HashSet<&str> = result.nodes.iter().map(|n| n.id.as_str()).collect();
        assert!(ids.contains("A"));
        assert!(ids.contains("B"));
        assert!(ids.contains("D"));
        assert!(ids.contains("F"));
        assert!(!ids.contains("C"));
        assert!(!ids.contains("E"));
    }

    #[test]
    fn neighbors_depth_1_undirected() {
        let (_, kg) = build_test_graph();
        let result = kg.neighbors("D", 1, false).unwrap();
        let ids: HashSet<&str> = result.nodes.iter().map(|n| n.id.as_str()).collect();
        assert!(ids.contains("D"));
        assert!(ids.contains("A"));
        assert!(ids.contains("B"));
    }

    #[test]
    fn neighbors_depth_2() {
        let (_, kg) = build_test_graph();
        let result = kg.neighbors("A", 2, true).unwrap();
        let ids: HashSet<&str> = result.nodes.iter().map(|n| n.id.as_str()).collect();
        assert!(ids.contains("A"));
        assert!(ids.contains("B"));
        assert!(ids.contains("C"));
        assert!(ids.contains("D"));
        assert!(ids.contains("F"));
        assert!(!ids.contains("E"));
    }

    #[test]
    fn neighbors_isolated_node() {
        let (_, kg) = build_test_graph();
        let result = kg.neighbors("E", 1, true).unwrap();
        assert_eq!(result.nodes.len(), 1);
        assert_eq!(result.nodes[0].id, "E");
    }

    #[test]
    fn neighbors_unknown_node() {
        let (_, kg) = build_test_graph();
        let result = kg.neighbors("Z", 1, true);
        assert!(result.is_err());
        match result.unwrap_err() {
            GraphError::NodeNotFound { id } => assert_eq!(id, "Z"),
            other => panic!("expected NodeNotFound, got: {other:?}"),
        }
    }

    #[test]
    fn neighbors_induced_edges() {
        let (_, kg) = build_test_graph();
        let result = kg.neighbors("A", 1, true).unwrap();
        let edges: HashSet<(&str, &str)> = result
            .edges
            .iter()
            .map(|(s, t)| (s.as_str(), t.as_str()))
            .collect();
        assert!(edges.contains(&("A", "B")));
        assert!(edges.contains(&("A", "D")));
        assert!(edges.contains(&("A", "F")));
        assert!(edges.contains(&("B", "D")));
        assert!(!edges.contains(&("B", "C")));
    }

    #[test]
    fn neighbors_rich_node_info() {
        let (_, kg) = build_test_graph();
        let result = kg.neighbors("A", 1, true).unwrap();
        let f_node = result.nodes.iter().find(|n| n.id == "F").unwrap();
        assert!(f_node.is_stub);
        assert_eq!(f_node.title, "");
        let b_node = result.nodes.iter().find(|n| n.id == "B").unwrap();
        assert!(!b_node.is_stub);
        assert_eq!(b_node.title, "Beta");
    }

    // --- Step 5: shared ---

    #[test]
    fn shared_common_directed() {
        let (_, kg) = build_test_graph();
        let result = kg.shared("A", "B", true).unwrap();
        let ids: HashSet<&str> = result.iter().map(|n| n.id.as_str()).collect();
        assert!(ids.contains("D"));
        assert!(!ids.contains("C"));
        assert!(!ids.contains("F"));
    }

    #[test]
    fn shared_common_undirected() {
        let (_, kg) = build_test_graph();
        // C undirected: incoming {B} → {B}
        // D undirected: incoming {A, B} → {A, B}
        // Directed would give empty (no outgoing from C or D)
        let result = kg.shared("C", "D", false).unwrap();
        let ids: HashSet<&str> = result.iter().map(|n| n.id.as_str()).collect();
        assert!(ids.contains("B"));
        assert_eq!(ids.len(), 1);
    }

    #[test]
    fn shared_no_overlap() {
        let (_, kg) = build_test_graph();
        let result = kg.shared("C", "E", true).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn shared_unknown_node() {
        let (_, kg) = build_test_graph();
        let result = kg.shared("A", "Z", true);
        assert!(result.is_err());
    }

    #[test]
    fn shared_same_node() {
        let (_, kg) = build_test_graph();
        let result = kg.shared("A", "A", true).unwrap();
        let ids: HashSet<&str> = result.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids.len(), 3);
        assert!(ids.contains("B"));
        assert!(ids.contains("D"));
        assert!(ids.contains("F"));
    }

    // --- Step 6: paths ---

    #[test]
    fn paths_direct_edge() {
        let (_, kg) = build_test_graph();
        let result = kg.paths("A", "B", 1, true).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], vec!["A", "B"]);
    }

    #[test]
    fn paths_two_hop() {
        let (_, kg) = build_test_graph();
        let result = kg.paths("A", "C", 2, true).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], vec!["A", "B", "C"]);
    }

    #[test]
    fn paths_multiple() {
        let (_, kg) = build_test_graph();
        let mut result = kg.paths("A", "D", 2, true).unwrap();
        result.sort();
        assert_eq!(result.len(), 2);
        assert!(result.contains(&vec!["A".to_string(), "D".to_string()]));
        assert!(result.contains(&vec![
            "A".to_string(),
            "B".to_string(),
            "D".to_string()
        ]));
    }

    #[test]
    fn paths_no_path() {
        let (_, kg) = build_test_graph();
        let result = kg.paths("C", "A", 10, true).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn paths_max_depth_limit() {
        let (_, kg) = build_test_graph();
        let result = kg.paths("A", "C", 1, true).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn paths_same_source_target() {
        let (_, kg) = build_test_graph();
        let result = kg.paths("A", "A", 10, true).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn paths_unknown_node() {
        let (_, kg) = build_test_graph();
        let result = kg.paths("A", "Z", 10, true);
        assert!(result.is_err());
    }

    #[test]
    fn paths_undirected_reverse() {
        let (_, kg) = build_test_graph();
        let result = kg.paths("C", "A", 2, false).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], vec!["C", "B", "A"]);
    }

    // --- Step 7: subgraph ---

    #[test]
    fn subgraph_single_seed_matches_neighbors() {
        let (_, kg) = build_test_graph();
        let sub = kg.subgraph(&["A"], 1, true).unwrap();
        let neigh = kg.neighbors("A", 1, true).unwrap();
        let mut sub_ids: Vec<&str> = sub.nodes.iter().map(|n| n.id.as_str()).collect();
        let mut neigh_ids: Vec<&str> = neigh.nodes.iter().map(|n| n.id.as_str()).collect();
        sub_ids.sort();
        neigh_ids.sort();
        assert_eq!(sub_ids, neigh_ids);
    }

    #[test]
    fn subgraph_multiple_seeds() {
        let (_, kg) = build_test_graph();
        let result = kg.subgraph(&["A", "E"], 0, true).unwrap();
        let ids: HashSet<&str> = result.nodes.iter().map(|n| n.id.as_str()).collect();
        assert!(ids.contains("A"));
        assert!(ids.contains("E"));
        assert_eq!(ids.len(), 2);
    }

    #[test]
    fn subgraph_unknown_seed_error() {
        let (_, kg) = build_test_graph();
        let result = kg.subgraph(&["Z"], 1, true);
        assert!(result.is_err());
    }

    #[test]
    fn subgraph_empty_seeds_returns_full_graph() {
        let (_, kg) = build_test_graph();
        let result = kg.subgraph(&[], 1, false).unwrap();
        let full = kg.full_subgraph();
        assert_eq!(result.nodes.len(), full.nodes.len());
        assert_eq!(result.edges.len(), full.edges.len());
    }

    #[test]
    fn subgraph_overlapping_neighborhoods_dedup() {
        let (_, kg) = build_test_graph();
        let result = kg.subgraph(&["A", "B"], 1, true).unwrap();
        let ids: HashSet<&str> = result.nodes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids.len(), 5);
        assert!(ids.contains("A"));
        assert!(ids.contains("B"));
        assert!(ids.contains("C"));
        assert!(ids.contains("D"));
        assert!(ids.contains("F"));
    }

    #[test]
    fn subgraph_depth_0_with_edges_between_seeds() {
        let (_, kg) = build_test_graph();
        let result = kg.subgraph(&["A", "B"], 0, true).unwrap();
        let ids: HashSet<&str> = result.nodes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids.len(), 2);
        let edges: HashSet<(&str, &str)> = result
            .edges
            .iter()
            .map(|(s, t)| (s.as_str(), t.as_str()))
            .collect();
        assert!(edges.contains(&("A", "B")));
    }

    // --- PageRank ---

    #[test]
    fn pagerank_scores_sum_to_one() {
        let (_, kg) = build_test_graph();
        let scores = kg.pagerank(0.85);
        let sum: f64 = scores.values().sum();
        assert!((sum - 1.0).abs() < 1e-9, "sum was {sum}");
    }

    #[test]
    fn pagerank_all_nodes_present() {
        let (_, kg) = build_test_graph();
        let scores = kg.pagerank(0.85);
        assert_eq!(scores.len(), 6);
        for id in &["A", "B", "C", "D", "E", "F"] {
            assert!(scores.contains_key(*id), "missing {id}");
        }
    }

    #[test]
    fn pagerank_all_scores_positive() {
        let (_, kg) = build_test_graph();
        let scores = kg.pagerank(0.85);
        for (id, score) in &scores {
            assert!(*score > 0.0, "{id} has non-positive score {score}");
        }
    }

    #[test]
    fn pagerank_hub_scores_higher() {
        let (_, kg) = build_test_graph();
        let scores = kg.pagerank(0.85);
        assert!(
            scores["D"] > scores["E"],
            "D={} should beat E={}",
            scores["D"],
            scores["E"]
        );
        assert!(
            scores["D"] > scores["C"],
            "D={} should beat C={}",
            scores["D"],
            scores["C"]
        );
    }

    #[test]
    fn pagerank_empty_graph() {
        let store = Store::open_memory().unwrap();
        let kg = KnowledgeGraph::from_store(&store).unwrap();
        let scores = kg.pagerank(0.85);
        assert!(scores.is_empty());
    }

    #[test]
    fn pagerank_single_node() {
        let store = Store::open_memory().unwrap();
        store.upsert_node(&make_node("X", "Solo"), 1).unwrap();
        let kg = KnowledgeGraph::from_store(&store).unwrap();
        let scores = kg.pagerank(0.85);
        assert_eq!(scores.len(), 1);
        assert!((scores["X"] - 1.0).abs() < 1e-9);
    }

    #[test]
    fn pagerank_damping_zero_gives_uniform() {
        let (_, kg) = build_test_graph();
        let scores = kg.pagerank(0.0);
        let expected = 1.0 / 6.0;
        for (id, score) in &scores {
            assert!(
                (*score - expected).abs() < 1e-9,
                "{id} score {score} != {expected}"
            );
        }
    }

    #[test]
    fn pagerank_stub_participates() {
        let (_, kg) = build_test_graph();
        let scores = kg.pagerank(0.85);
        assert!(scores.contains_key("F"));
        assert!(scores["F"] > 0.0);
    }

    #[test]
    fn graph_clone_preserves_structure() {
        let (_, kg) = build_test_graph();
        let cloned = kg.graph_clone();
        assert_eq!(cloned.node_count(), 6);
        assert_eq!(cloned.edge_count(), 5);
    }

    #[test]
    fn profile_pipeline_at_scale() {
        use std::time::Instant;

        fn build_large_graph(node_count: usize, edge_density: usize) -> KnowledgeGraph {
            let store = Store::open_memory().unwrap();
            for i in 0..node_count {
                let id = format!("page-{i}");
                let title = format!("Page {i}");
                if i < (node_count * 9 / 10) {
                    store
                        .upsert_node(
                            &ParsedNode {
                                id: id.clone(),
                                title,
                                tags: vec![],
                                frontmatter: serde_json::json!({}),
                                first_paragraph: String::new(),
                            },
                            1,
                        )
                        .unwrap();
                } else {
                    store.upsert_stub(&id).unwrap();
                }
            }
            let mut rng_state: u32 = 42;
            let target_edges = node_count * edge_density;
            let mut added = 0;
            while added < target_edges {
                rng_state ^= rng_state << 13;
                rng_state ^= rng_state >> 17;
                rng_state ^= rng_state << 5;
                let src = (rng_state as usize) % node_count;
                rng_state ^= rng_state << 13;
                rng_state ^= rng_state >> 17;
                rng_state ^= rng_state << 5;
                let tgt = (rng_state as usize) % node_count;
                if src != tgt {
                    let _ = store.insert_edge(
                        &format!("page-{src}"),
                        &format!("page-{tgt}"),
                        "",
                        "",
                        0,
                    );
                    added += 1;
                }
            }
            KnowledgeGraph::from_store(&store).unwrap()
        }

        for &n in &[500usize, 1_000, 5_000, 10_000] {
            let kg = build_large_graph(n, 3);

            let t0 = Instant::now();
            let subgraph = kg.full_subgraph();
            let subgraph_ms = t0.elapsed().as_secs_f64() * 1000.0;

            let t0 = Instant::now();
            let scores = kg.pagerank(0.85);
            let pagerank_ms = t0.elapsed().as_secs_f64() * 1000.0;

            let t0 = Instant::now();
            let json_sub = serde_json::to_string(&subgraph).unwrap();
            let json_pr = serde_json::to_string(&scores).unwrap();
            let serialize_ms = t0.elapsed().as_secs_f64() * 1000.0;

            let payload_kb = (json_sub.len() + json_pr.len()) as f64 / 1024.0;

            eprintln!(
                "[{n:>6} nodes] subgraph={subgraph_ms:.2}ms  pagerank={pagerank_ms:.2}ms  \
                 serialize={serialize_ms:.2}ms  payload={payload_kb:.0}kB"
            );
        }
    }
}
