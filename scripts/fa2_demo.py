#!/usr/bin/env python3
"""
Visualize FA2 layout output from our Rust implementation.

Step 1: Generate the data (from repo root):
    cd src-tauri && cargo test dump_fa2_demo_layouts -- --nocapture

Step 2: Plot:
    pip install matplotlib
    python scripts/fa2_demo.py
"""

import json
import os
import matplotlib
if not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY"):
    matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pathlib import Path

data_path = Path(__file__).parent / "fa2_demo_data.json"
if not data_path.exists():
    raise SystemExit(
        f"Missing {data_path}\n"
        "Run: cd src-tauri && cargo test dump_fa2_demo_layouts -- --nocapture"
    )

data = json.loads(data_path.read_text())

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))

for ax, key, title in [
    (ax1, "well_connected", "Well-connected (80 nodes)"),
    (ax2, "with_isolates", "30-node core + 50 isolates"),
]:
    graph = data[key]
    nodes = graph["nodes"]
    edges = graph["edges"]

    pos = {n["id"]: (n["x"], n["y"]) for n in nodes}

    for e in edges:
        x0, y0 = pos[e["source"]]
        x1, y1 = pos[e["target"]]
        ax.plot([x0, x1], [y0, y1], color="gray", alpha=0.12, linewidth=0.5)

    connected = [n for n in nodes if n["degree"] > 0]
    isolated = [n for n in nodes if n["degree"] == 0]

    if connected:
        ax.scatter(
            [n["x"] for n in connected],
            [n["y"] for n in connected],
            s=[20 + n["degree"] * 6 for n in connected],
            c="steelblue", alpha=0.8, label=f"connected ({len(connected)})",
        )
    if isolated:
        ax.scatter(
            [n["x"] for n in isolated],
            [n["y"] for n in isolated],
            s=20, c="tomato", alpha=0.8, label=f"isolated ({len(isolated)})",
        )

    ax.set_title(title, fontsize=13)
    ax.set_aspect("equal")
    ax.legend(loc="upper right", fontsize=9)
    ax.axis("off")

fig.suptitle("ForceAtlas2 (Rust): connected vs. isolated nodes", fontsize=15, y=0.98)
fig.tight_layout()

out_path = Path(__file__).parent / "fa2_demo.png"
plt.savefig(out_path, dpi=150, bbox_inches="tight")
print(f"Saved to {out_path}")
plt.show()
