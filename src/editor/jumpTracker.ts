const MAX_JUMPS = 100;

export interface Jump {
  notePath: string;
  line: number;
  col: number;
}

export class JumpTracker {
  private _jumps: Jump[] = [];
  private _index = -1;
  isNavigating = false;

  get jumps(): readonly Jump[] {
    return this._jumps;
  }

  recordJump(from: Jump, to: Jump): void {
    if (
      from.notePath === to.notePath &&
      from.line === to.line &&
      Math.abs(from.col - to.col) <= 1
    ) return;

    if (this._index !== -1) {
      this._jumps.length = this._index + 1;
      this._index = -1;
    }

    const existing = this._jumps.findIndex(
      (j) => j.notePath === from.notePath && j.line === from.line,
    );
    if (existing !== -1) {
      this._jumps.splice(existing, 1);
    }

    this._jumps.push(from);

    while (this._jumps.length > MAX_JUMPS) {
      this._jumps.shift();
    }
  }

  navigateBack(current: Jump): Jump | null {
    if (this._jumps.length === 0) return null;

    if (this._index === -1) {
      this._jumps.push(current);
      while (this._jumps.length > MAX_JUMPS) {
        this._jumps.shift();
      }
      this._index = this._jumps.length - 2;
    } else {
      this._index--;
    }

    if (this._index < 0) {
      this._index = 0;
      return null;
    }

    return this._jumps[this._index]!;
  }

  navigateForward(): Jump | null {
    if (this._index === -1 || this._index >= this._jumps.length - 1) return null;
    this._index++;
    return this._jumps[this._index]!;
  }

  clear(): void {
    this._jumps.length = 0;
    this._index = -1;
    this.isNavigating = false;
  }
}

export const globalJumpTracker = new JumpTracker();
