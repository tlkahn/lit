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
}
