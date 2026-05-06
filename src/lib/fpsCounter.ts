export interface FpsStats {
  avg: number;
  min: number;
  max: number;
  samples: number;
  durationMs: number;
}

export class FpsCounter {
  private rafId = 0;
  private deltas: number[] = [];
  private lastTime = -1;
  private startTime = 0;
  private running = false;

  start() {
    if (this.running) return;
    this.running = true;
    this.deltas = [];
    this.lastTime = -1;
    this.startTime = performance.now();
    this.tick();
  }

  stop(): FpsStats {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    const durationMs = performance.now() - this.startTime;
    if (this.deltas.length === 0) {
      return { avg: 0, min: 0, max: 0, samples: 0, durationMs };
    }
    const fps = this.deltas.map((d) => (d > 0 ? 1000 / d : 0));
    const sum = fps.reduce((a, b) => a + b, 0);
    return {
      avg: sum / fps.length,
      min: Math.min(...fps),
      max: Math.max(...fps),
      samples: fps.length,
      durationMs,
    };
  }

  isRunning() {
    return this.running;
  }

  private tick() {
    this.rafId = requestAnimationFrame((now) => {
      if (!this.running) return;
      if (this.lastTime >= 0) {
        this.deltas.push(now - this.lastTime);
      }
      this.lastTime = now;
      this.tick();
    });
  }
}
