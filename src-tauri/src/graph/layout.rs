#[derive(Clone, Copy)]
pub struct BoundingBox {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
}

impl BoundingBox {
    pub fn new(min_x: f64, max_x: f64, min_y: f64, max_y: f64) -> Self {
        Self { min_x, max_x, min_y, max_y }
    }

    pub fn width(&self) -> f64 {
        self.max_x - self.min_x
    }

    pub fn child(&self, quadrant: usize) -> Self {
        let cx = (self.min_x + self.max_x) * 0.5;
        let cy = (self.min_y + self.max_y) * 0.5;
        let (min_x, max_x) = if quadrant & 1 == 0 {
            (self.min_x, cx)
        } else {
            (cx, self.max_x)
        };
        let (min_y, max_y) = if quadrant & 2 == 0 {
            (self.min_y, cy)
        } else {
            (cy, self.max_y)
        };
        Self { min_x, max_x, min_y, max_y }
    }

    pub fn quadrant(&self, x: f64, y: f64) -> usize {
        let cx = (self.min_x + self.max_x) * 0.5;
        let cy = (self.min_y + self.max_y) * 0.5;
        let x_bit = (x >= cx) as usize;
        let y_bit = (y >= cy) as usize;
        (y_bit << 1) | x_bit
    }
}

use smallvec::SmallVec;

const EPSILON: f64 = 1e-4;
const MAX_DEPTH: usize = 64;

pub struct QuadNode {
    pub cx: f64,
    pub cy: f64,
    pub mass: f64,
    pub children: [Option<Box<QuadNode>>; 4],
}

impl QuadNode {
    pub fn empty() -> Self {
        Self {
            cx: 0.0,
            cy: 0.0,
            mass: 0.0,
            children: [None, None, None, None],
        }
    }

    pub fn is_leaf(&self) -> bool {
        self.children.iter().all(|c| c.is_none())
    }

    pub fn insert(&mut self, x: f64, y: f64, m: f64, bb: &BoundingBox) {
        if self.mass == 0.0 {
            self.cx = x;
            self.cy = y;
            self.mass = m;
            return;
        }

        let mut node = self as *mut QuadNode;
        let mut current_bb = *bb;
        let mut depth = 0usize;

        unsafe {
            loop {
                if depth >= MAX_DEPTH {
                    return;
                }

                let n = &mut *node;

                if n.is_leaf() {
                    let old_mass = n.mass;
                    let orig_x = n.cx;
                    let orig_y = n.cy;

                    let dx = orig_x - x;
                    let dy = orig_y - y;
                    if (dx * dx + dy * dy).sqrt() < EPSILON {
                        return;
                    }

                    // Update COM for this node
                    let new_mass = old_mass + m;
                    n.cx = (orig_x * old_mass + x * m) / new_mass;
                    n.cy = (orig_y * old_mass + y * m) / new_mass;
                    n.mass = new_mass;

                    // Split: push existing point and new point down
                    loop {
                        if depth >= MAX_DEPTH {
                            return;
                        }
                        let q_old = current_bb.quadrant(orig_x, orig_y);
                        let q_new = current_bb.quadrant(x, y);

                        if q_old != q_new {
                            let nn = &mut *node;
                            let mut old_child = QuadNode::empty();
                            old_child.cx = orig_x;
                            old_child.cy = orig_y;
                            old_child.mass = old_mass;
                            nn.children[q_old] = Some(Box::new(old_child));

                            let mut new_child = QuadNode::empty();
                            new_child.cx = x;
                            new_child.cy = y;
                            new_child.mass = m;
                            nn.children[q_new] = Some(Box::new(new_child));
                            return;
                        }

                        // Same quadrant: create intermediate node and descend
                        let nn = &mut *node;
                        let child_bb = current_bb.child(q_old);
                        let mut intermediate = QuadNode::empty();
                        intermediate.cx = (orig_x * old_mass + x * m) / (old_mass + m);
                        intermediate.cy = (orig_y * old_mass + y * m) / (old_mass + m);
                        intermediate.mass = old_mass + m;
                        nn.children[q_old] = Some(Box::new(intermediate));
                        node = nn.children[q_old].as_mut().unwrap().as_mut() as *mut QuadNode;
                        current_bb = child_bb;
                        depth += 1;
                    }
                }

                // Non-leaf: update COM and descend
                let new_mass = n.mass + m;
                n.cx = (n.cx * n.mass + x * m) / new_mass;
                n.cy = (n.cy * n.mass + y * m) / new_mass;
                n.mass = new_mass;

                let q = current_bb.quadrant(x, y);
                current_bb = current_bb.child(q);
                if n.children[q].is_none() {
                    n.children[q] = Some(Box::new(QuadNode::empty()));
                }
                node = n.children[q].as_mut().unwrap().as_mut() as *mut QuadNode;
                depth += 1;
            }
        }
    }
}

impl QuadNode {
    pub fn repulsion_on(&self, bx: f64, by: f64, theta: f64, bb: &BoundingBox) -> (f64, f64) {
        let mut fx = 0.0;
        let mut fy = 0.0;
        let mut stack: SmallVec<[(&QuadNode, BoundingBox); 64]> = SmallVec::new();
        stack.push((self, *bb));

        while let Some((node, node_bb)) = stack.pop() {
            if node.mass == 0.0 {
                continue;
            }

            let dx = bx - node.cx;
            let dy = by - node.cy;
            let dist = (dx * dx + dy * dy).sqrt();

            if dist < EPSILON {
                continue;
            }

            let width = node_bb.width();

            if node.is_leaf() || (width / dist) < theta {
                fx += (dx / dist) * node.mass;
                fy += (dy / dist) * node.mass;
            } else {
                for (i, child) in node.children.iter().enumerate() {
                    if let Some(c) = child {
                        stack.push((c.as_ref(), node_bb.child(i)));
                    }
                }
            }
        }

        (fx, fy)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct LayoutNode {
    pub x: f64,
    pub y: f64,
    pub sx: f64,
    pub sy: f64,
    pub old_sx: f64,
    pub old_sy: f64,
    pub mass: f64,
}

impl Default for LayoutNode {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            sx: 0.0,
            sy: 0.0,
            old_sx: 0.0,
            old_sy: 0.0,
            mass: 1.0,
        }
    }
}

#[derive(Clone, Debug)]
pub struct LayoutSettings {
    pub theta: f64,
    pub ka: f64,
    pub kg: f64,
    pub kr: f64,
    pub speed: f64,
    pub strong_gravity: bool,
    pub iterations_cold: usize,
    pub iterations_warm: usize,
}

impl Default for LayoutSettings {
    fn default() -> Self {
        Self {
            theta: 0.5,
            ka: 1.0,
            kg: 1.0,
            kr: 1.0,
            speed: 0.01,
            strong_gravity: false,
            iterations_cold: 100,
            iterations_warm: 50,
        }
    }
}

fn compute_bounding_box(nodes: &[LayoutNode]) -> BoundingBox {
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for n in nodes {
        if n.x < min_x { min_x = n.x; }
        if n.x > max_x { max_x = n.x; }
        if n.y < min_y { min_y = n.y; }
        if n.y > max_y { max_y = n.y; }
    }
    BoundingBox { min_x, max_x, min_y, max_y }
}

pub fn fa2_iteration(
    nodes: &mut [LayoutNode],
    edges: &[(usize, usize)],
    settings: &LayoutSettings,
) -> (f64, f64) {
    apply_attraction(nodes, edges, settings);
    apply_repulsion(nodes, settings);
    apply_gravity(nodes, settings);
    apply_forces(nodes, settings)
}

pub fn apply_forces(nodes: &mut [LayoutNode], settings: &LayoutSettings) -> (f64, f64) {
    let mut sum_swinging = 0.0;
    let mut sum_traction = 0.0;
    for n in nodes.iter_mut() {
        let sw_x = n.sx - n.old_sx;
        let sw_y = n.sy - n.old_sy;
        let swinging = (sw_x * sw_x + sw_y * sw_y).sqrt();

        let tr_x = n.sx + n.old_sx;
        let tr_y = n.sy + n.old_sy;
        let traction = (tr_x * tr_x + tr_y * tr_y).sqrt() * 0.5;

        let factor = (1.0 + traction).ln() / (swinging.sqrt() + 1.0) * settings.speed;

        n.x += n.sx * factor;
        n.y += n.sy * factor;
        n.old_sx = n.sx;
        n.old_sy = n.sy;
        n.sx = 0.0;
        n.sy = 0.0;

        sum_swinging += swinging;
        sum_traction += traction;
    }
    (sum_swinging, sum_traction)
}

pub fn apply_gravity(nodes: &mut [LayoutNode], settings: &LayoutSettings) {
    for n in nodes.iter_mut() {
        let dist = (n.x * n.x + n.y * n.y).sqrt();
        let coeff = (n.mass + 1.0) * settings.kg;
        if settings.strong_gravity {
            n.sx -= n.x * coeff;
            n.sy -= n.y * coeff;
        } else if dist > EPSILON {
            n.sx -= n.x * coeff / dist;
            n.sy -= n.y * coeff / dist;
        }
    }
}

pub fn apply_repulsion(nodes: &mut [LayoutNode], settings: &LayoutSettings) {
    let bb = compute_bounding_box(nodes);
    let mut tree = QuadNode::empty();
    for n in nodes.iter() {
        tree.insert(n.x, n.y, n.mass, &bb);
    }
    for n in nodes.iter_mut() {
        let (fx, fy) = tree.repulsion_on(n.x, n.y, settings.theta, &bb);
        let coeff = settings.kr * (n.mass + 1.0);
        n.sx += fx * coeff;
        n.sy += fy * coeff;
    }
}

pub fn apply_attraction(
    nodes: &mut [LayoutNode],
    edges: &[(usize, usize)],
    settings: &LayoutSettings,
) {
    for &(i, j) in edges {
        let dx = nodes[j].x - nodes[i].x;
        let dy = nodes[j].y - nodes[i].y;
        let fx = dx * settings.ka;
        let fy = dy * settings.ka;
        nodes[i].sx += fx;
        nodes[i].sy += fy;
        nodes[j].sx -= fx;
        nodes[j].sy -= fy;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounding_box_is_copy() {
        fn assert_copy<T: Copy>(_: &T) {}
        let bb = BoundingBox::new(0.0, 100.0, 0.0, 50.0);
        assert_copy(&bb);
    }

    #[test]
    fn bounding_box_width() {
        let bb = BoundingBox::new(0.0, 100.0, 0.0, 50.0);
        assert_eq!(bb.width(), 100.0);
    }

    #[test]
    fn repulsion_on_deep_tree() {
        let bb = BoundingBox::new(0.0, 1000.0, 0.0, 1000.0);
        let mut tree = QuadNode::empty();
        for i in 0..20 {
            let x = 50.0 + (i as f64) * 45.0;
            let y = 50.0 + (i as f64) * 45.0;
            tree.insert(x, y, 1.0, &bb);
        }

        let (fx, fy) = tree.repulsion_on(500.0, 0.0, 0.5, &bb);
        // Force should push query away from the cluster (which is along the diagonal)
        // x-component near zero (cluster centered around x=500), y-component negative (away from cluster above)
        assert!(fy < 0.0);
        let mag = (fx * fx + fy * fy).sqrt();
        assert!(mag > 0.0);
    }

    #[test]
    fn repulsion_on_self_and_empty() {
        let bb = BoundingBox::new(0.0, 100.0, 0.0, 100.0);

        // Empty tree returns zero force
        let empty = QuadNode::empty();
        let (fx, fy) = empty.repulsion_on(50.0, 50.0, 0.0, &bb);
        assert_eq!(fx, 0.0);
        assert_eq!(fy, 0.0);

        // Query at exact position of tree node → zero force (skip self)
        let mut tree = QuadNode::empty();
        tree.insert(50.0, 50.0, 3.0, &bb);
        let (fx, fy) = tree.repulsion_on(50.0, 50.0, 0.0, &bb);
        assert_eq!(fx, 0.0);
        assert_eq!(fy, 0.0);
    }

    #[test]
    fn repulsion_on_bh_approximation() {
        let bb = BoundingBox::new(0.0, 200.0, 0.0, 200.0);
        let mut tree = QuadNode::empty();
        // Tight cluster near (100, 100)
        tree.insert(98.0, 98.0, 1.0, &bb);
        tree.insert(102.0, 98.0, 1.0, &bb);
        tree.insert(98.0, 102.0, 1.0, &bb);
        tree.insert(102.0, 102.0, 1.0, &bb);

        // Query from origin — far from the cluster
        let (ex, ey) = tree.repulsion_on(0.0, 0.0, 0.0, &bb); // exact
        let (ax, ay) = tree.repulsion_on(0.0, 0.0, 2.0, &bb); // approximate

        let exact_mag = (ex * ex + ey * ey).sqrt();
        let approx_mag = (ax * ax + ay * ay).sqrt();
        assert!((exact_mag - approx_mag).abs() / exact_mag < 0.1);

        // Direction should be similar
        let dot = ex * ax + ey * ay;
        assert!(dot > 0.0); // pointing same direction
    }

    #[test]
    fn repulsion_on_single_body() {
        let bb = BoundingBox::new(-100.0, 100.0, -100.0, 100.0);
        let mut tree = QuadNode::empty();
        tree.insert(0.0, 0.0, 4.0, &bb);

        // Query from (3, 4), distance = 5
        let (fx, fy) = tree.repulsion_on(3.0, 4.0, 0.0, &bb);
        // unit_direction_away * node_mass = (3/5, 4/5) * 4 = (2.4, 3.2)
        assert!((fx - 2.4).abs() < 1e-10);
        assert!((fy - 3.2).abs() < 1e-10);
    }

    #[test]
    fn quad_node_max_depth_no_overflow() {
        let bb = BoundingBox::new(0.0, 100.0, 0.0, 100.0);
        let mut tree = QuadNode::empty();
        tree.insert(50.0, 50.0, 1.0, &bb);
        // Very close but technically different — would recurse infinitely without depth guard
        tree.insert(50.0 + 1e-15, 50.0 + 1e-15, 1.0, &bb);
        // Should not stack overflow; second point dropped (coincident or depth limit)
        assert!(tree.mass <= 2.0);
    }

    #[test]
    fn quad_node_coincident_point_dropped() {
        let bb = BoundingBox::new(0.0, 100.0, 0.0, 100.0);
        let mut tree = QuadNode::empty();
        tree.insert(50.0, 50.0, 2.0, &bb);
        tree.insert(50.00001, 50.00001, 3.0, &bb); // within EPSILON=1e-4
        assert_eq!(tree.mass, 2.0); // second point dropped
        assert!(tree.is_leaf());
    }

    #[test]
    fn quad_node_center_of_mass() {
        let bb = BoundingBox::new(0.0, 200.0, 0.0, 200.0);
        let mut tree = QuadNode::empty();
        tree.insert(0.0, 0.0, 1.0, &bb);
        tree.insert(100.0, 0.0, 3.0, &bb);
        tree.insert(0.0, 100.0, 2.0, &bb);

        assert_eq!(tree.mass, 6.0);
        let expected_cx = (0.0 + 300.0 + 0.0) / 6.0; // 50.0
        let expected_cy = (0.0 + 0.0 + 200.0) / 6.0;  // 33.333...
        assert!((tree.cx - expected_cx).abs() < 1e-10);
        assert!((tree.cy - expected_cy).abs() < 1e-10);
    }

    #[test]
    fn quad_node_two_body_split() {
        let bb = BoundingBox::new(0.0, 100.0, 0.0, 100.0);
        let mut tree = QuadNode::empty();
        tree.insert(10.0, 10.0, 1.0, &bb);
        tree.insert(90.0, 90.0, 1.0, &bb);

        assert!(!tree.is_leaf());
        assert_eq!(tree.mass, 2.0);
        assert_eq!(tree.cx, 50.0);
        assert_eq!(tree.cy, 50.0);
        // (10,10) → quadrant 0 (SW), (90,90) → quadrant 3 (NE)
        assert!(tree.children[0].is_some());
        assert!(tree.children[1].is_none());
        assert!(tree.children[2].is_none());
        assert!(tree.children[3].is_some());
    }

    #[test]
    fn quad_node_empty_and_single_insert() {
        let mut tree = QuadNode::empty();
        assert_eq!(tree.mass, 0.0);

        let bb = BoundingBox::new(0.0, 100.0, 0.0, 100.0);
        tree.insert(10.0, 20.0, 5.0, &bb);
        assert_eq!(tree.cx, 10.0);
        assert_eq!(tree.cy, 20.0);
        assert_eq!(tree.mass, 5.0);
        assert!(tree.is_leaf());
    }

    #[test]
    fn bounding_box_child() {
        let bb = BoundingBox::new(0.0, 100.0, 0.0, 100.0);
        let se = bb.child(0b01); // SE lower quadrant
        assert_eq!(se.min_x, 50.0);
        assert_eq!(se.max_x, 100.0);
        assert_eq!(se.min_y, 0.0);
        assert_eq!(se.max_y, 50.0);
    }

    #[test]
    fn bounding_box_quadrant() {
        let bb = BoundingBox::new(0.0, 100.0, 0.0, 100.0);
        assert_eq!(bb.quadrant(25.0, 25.0), 0); // SW
        assert_eq!(bb.quadrant(75.0, 25.0), 1); // SE
        assert_eq!(bb.quadrant(25.0, 75.0), 2); // NW
        assert_eq!(bb.quadrant(75.0, 75.0), 3); // NE
    }

    #[test]
    fn layout_node_default() {
        let n = LayoutNode::default();
        assert_eq!(n.x, 0.0);
        assert_eq!(n.y, 0.0);
        assert_eq!(n.sx, 0.0);
        assert_eq!(n.sy, 0.0);
        assert_eq!(n.old_sx, 0.0);
        assert_eq!(n.old_sy, 0.0);
        assert_eq!(n.mass, 1.0);
    }

    #[test]
    fn layout_node_is_copy() {
        fn assert_copy<T: Copy>(_: &T) {}
        assert_copy(&LayoutNode::default());
    }

    #[test]
    fn layout_settings_default() {
        let s = LayoutSettings::default();
        assert_eq!(s.theta, 0.5);
        assert_eq!(s.ka, 1.0);
        assert_eq!(s.kg, 1.0);
        assert_eq!(s.kr, 1.0);
        assert_eq!(s.speed, 0.01);
        assert!(!s.strong_gravity);
        assert_eq!(s.iterations_cold, 100);
        assert_eq!(s.iterations_warm, 50);
    }

    #[test]
    fn layout_settings_is_clone() {
        let s = LayoutSettings::default();
        let s2 = s.clone();
        assert_eq!(s2.theta, s.theta);
        assert_eq!(s2.iterations_cold, s.iterations_cold);
    }

    #[test]
    fn apply_attraction_two_nodes() {
        let mut nodes = vec![
            LayoutNode { x: 0.0, y: 0.0, ..Default::default() },
            LayoutNode { x: 10.0, y: 0.0, ..Default::default() },
        ];
        let edges = vec![(0usize, 1usize)];
        let settings = LayoutSettings { ka: 2.0, ..Default::default() };

        apply_attraction(&mut nodes, &edges, &settings);

        // f = (pos_j - pos_i) * ka = (10-0)*2 = 20 applied to node 0's sx
        // node 0: sx += 20, node 1: sx -= 20
        assert!((nodes[0].sx - 20.0).abs() < 1e-10);
        assert!((nodes[0].sy - 0.0).abs() < 1e-10);
        assert!((nodes[1].sx - (-20.0)).abs() < 1e-10);
        assert!((nodes[1].sy - 0.0).abs() < 1e-10);
    }

    #[test]
    fn fa2_iteration_moves_nodes_apart() {
        // Two connected nodes at same x, should repel and also attract
        // After one iteration with balanced settings, positions should change
        let mut nodes = vec![
            LayoutNode { x: 0.0, y: 0.0, ..Default::default() },
            LayoutNode { x: 1.0, y: 0.0, ..Default::default() },
        ];
        let edges = vec![(0usize, 1usize)];
        let settings = LayoutSettings {
            ka: 1.0,
            kr: 10.0,
            kg: 0.0,
            speed: 1.0,
            theta: 0.0,
            ..Default::default()
        };

        let (sw, tr) = fa2_iteration(&mut nodes, &edges, &settings);

        // Nodes should have moved (positions no longer at original)
        assert!(nodes[0].x != 0.0 || nodes[0].y != 0.0);
        assert!(nodes[1].x != 1.0 || nodes[1].y != 0.0);
        // Swinging/traction should be finite positive
        assert!(sw >= 0.0);
        assert!(tr >= 0.0);
        // sx/sy should be reset after apply_forces
        assert_eq!(nodes[0].sx, 0.0);
        assert_eq!(nodes[1].sx, 0.0);
    }

    #[test]
    fn fa2_iteration_returns_metrics() {
        // Single node at origin with no edges — gravity=0, no repulsion partner
        // All forces are zero → no movement, metrics are zero
        let mut nodes = vec![
            LayoutNode { x: 5.0, y: 5.0, ..Default::default() },
        ];
        let edges: Vec<(usize, usize)> = vec![];
        let settings = LayoutSettings { kg: 0.0, ..Default::default() };

        let (sw, tr) = fa2_iteration(&mut nodes, &edges, &settings);

        assert_eq!(sw, 0.0);
        assert_eq!(tr, 0.0);
        assert_eq!(nodes[0].x, 5.0);
        assert_eq!(nodes[0].y, 5.0);
    }

    #[test]
    fn apply_forces_single_node() {
        // Node with sx=4, sy=3, old_sx=0, old_sy=0, speed=1.0
        // swinging = sqrt((4-0)^2 + (3-0)^2) = 5
        // traction = sqrt((4+0)^2 + (3+0)^2) / 2 = 5/2 = 2.5
        // factor = ln(1+2.5) / (sqrt(5)+1) * 1.0 = ln(3.5) / (2.2360..+1)
        //        = 1.25276... / 3.23606... = 0.38715...
        // new x = 0 + 4 * factor = 1.5486...
        // new y = 0 + 3 * factor = 1.1614...
        // old_sx = 4, old_sy = 3, sx = 0, sy = 0 (reset)
        // sum_swinging = 5.0, sum_traction = 2.5
        let mut nodes = vec![
            LayoutNode { x: 0.0, y: 0.0, sx: 4.0, sy: 3.0, old_sx: 0.0, old_sy: 0.0, mass: 1.0 },
        ];
        let settings = LayoutSettings { speed: 1.0, ..Default::default() };

        let (sum_sw, sum_tr) = apply_forces(&mut nodes, &settings);

        let expected_factor = (1.0 + 2.5_f64).ln() / (5.0_f64.sqrt() + 1.0);
        assert!((nodes[0].x - 4.0 * expected_factor).abs() < 1e-10);
        assert!((nodes[0].y - 3.0 * expected_factor).abs() < 1e-10);
        assert_eq!(nodes[0].old_sx, 4.0);
        assert_eq!(nodes[0].old_sy, 3.0);
        assert_eq!(nodes[0].sx, 0.0);
        assert_eq!(nodes[0].sy, 0.0);
        assert!((sum_sw - 5.0).abs() < 1e-10);
        assert!((sum_tr - 2.5).abs() < 1e-10);
    }

    #[test]
    fn apply_gravity_standard() {
        // Node at (3, 4), dist=5, mass=1
        // sx -= x * (mass+1) * kg / dist = 3 * 2 * 1.0 / 5 = 1.2
        // sy -= y * (mass+1) * kg / dist = 4 * 2 * 1.0 / 5 = 1.6
        let mut nodes = vec![
            LayoutNode { x: 3.0, y: 4.0, ..Default::default() },
        ];
        let settings = LayoutSettings { kg: 1.0, strong_gravity: false, ..Default::default() };

        apply_gravity(&mut nodes, &settings);

        assert!((nodes[0].sx - (-1.2)).abs() < 1e-10);
        assert!((nodes[0].sy - (-1.6)).abs() < 1e-10);
    }

    #[test]
    fn apply_gravity_strong() {
        // Strong gravity: sx -= x * (mass+1) * kg (no /dist)
        // Node at (3, 4), mass=1, kg=2
        // sx -= 3 * 2 * 2 = -12
        // sy -= 4 * 2 * 2 = -16
        let mut nodes = vec![
            LayoutNode { x: 3.0, y: 4.0, ..Default::default() },
        ];
        let settings = LayoutSettings { kg: 2.0, strong_gravity: true, ..Default::default() };

        apply_gravity(&mut nodes, &settings);

        assert!((nodes[0].sx - (-12.0)).abs() < 1e-10);
        assert!((nodes[0].sy - (-16.0)).abs() < 1e-10);
    }

    #[test]
    fn apply_gravity_at_origin() {
        // Node at origin: dist=0, gravity should not divide by zero
        let mut nodes = vec![
            LayoutNode { x: 0.0, y: 0.0, ..Default::default() },
        ];
        let settings = LayoutSettings { kg: 5.0, strong_gravity: false, ..Default::default() };

        apply_gravity(&mut nodes, &settings);

        assert_eq!(nodes[0].sx, 0.0);
        assert_eq!(nodes[0].sy, 0.0);
    }

    #[test]
    fn apply_repulsion_two_nodes() {
        // Two nodes at (0,0) and (3,4), distance=5, each mass=1
        // repulsion_on returns unit_dir_away * other_mass
        // For node 0 querying tree: node 1 is at (3,4), direction away from (3,4) toward (0,0) is (-3/5, -4/5)*1
        // But tree contains BOTH nodes. For node 0:
        //   - self at (0,0) is skipped (EPSILON)
        //   - node 1 at (3,4): dir away = (0-3, 0-4)/5 = (-3/5, -4/5), * mass 1 = (-0.6, -0.8)
        // repulsion force on node 0: kr * (mass+1) * (-0.6, -0.8) = 1 * 2 * (-0.6, -0.8) = (-1.2, -1.6)
        // For node 1:
        //   - node 0 at (0,0): dir away = (3-0, 4-0)/5 = (3/5, 4/5), * mass 1 = (0.6, 0.8)
        //   - self skipped
        // repulsion force on node 1: kr * (mass+1) * (0.6, 0.8) = 1 * 2 * (0.6, 0.8) = (1.2, 1.6)
        let mut nodes = vec![
            LayoutNode { x: 0.0, y: 0.0, ..Default::default() },
            LayoutNode { x: 3.0, y: 4.0, ..Default::default() },
        ];
        let settings = LayoutSettings { kr: 1.0, theta: 0.0, ..Default::default() };

        apply_repulsion(&mut nodes, &settings);

        assert!((nodes[0].sx - (-1.2)).abs() < 1e-10);
        assert!((nodes[0].sy - (-1.6)).abs() < 1e-10);
        assert!((nodes[1].sx - 1.2).abs() < 1e-10);
        assert!((nodes[1].sy - 1.6).abs() < 1e-10);
    }

    #[test]
    fn compute_bounding_box_basic() {
        let nodes = vec![
            LayoutNode { x: -5.0, y: 3.0, ..Default::default() },
            LayoutNode { x: 10.0, y: -7.0, ..Default::default() },
            LayoutNode { x: 2.0, y: 15.0, ..Default::default() },
        ];
        let bb = compute_bounding_box(&nodes);
        assert_eq!(bb.min_x, -5.0);
        assert_eq!(bb.max_x, 10.0);
        assert_eq!(bb.min_y, -7.0);
        assert_eq!(bb.max_y, 15.0);
    }
}
