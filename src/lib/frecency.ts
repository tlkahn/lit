const STORAGE_KEY = "lit-palette-frecency";
const HALF_LIFE_HOURS = 168;

interface FrecencyEntry {
  count: number;
  lastAccess: number;
}

function load(): Record<string, FrecencyEntry> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function save(data: Record<string, FrecencyEntry>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function recordAccess(id: string): void {
  const data = load();
  const entry = data[id];
  if (entry) {
    entry.count++;
    entry.lastAccess = Date.now();
  } else {
    data[id] = { count: 1, lastAccess: Date.now() };
  }
  save(data);
}

export function getScore(id: string): number {
  const data = load();
  const entry = data[id];
  if (!entry) return 0;
  const ageHours = (Date.now() - entry.lastAccess) / (1000 * 60 * 60);
  return entry.count * Math.exp(-ageHours / HALF_LIFE_HOURS);
}

export function sortByFrecency<T>(items: T[], getId: (item: T) => string): T[] {
  const indexed = items.map((item, i) => ({ item, i }));
  indexed.sort((a, b) => {
    const diff = getScore(getId(b.item)) - getScore(getId(a.item));
    if (diff !== 0) return diff;
    return a.i - b.i;
  });
  return indexed.map((e) => e.item);
}

export function _clear(): void {
  localStorage.removeItem(STORAGE_KEY);
}
