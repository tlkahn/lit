const STORAGE_KEY = "lit-palette-frecency";
const HALF_LIFE_HOURS = 168;

interface FrecencyEntry {
  count: number;
  lastAccess: number;
}

type FrecencyData = Record<string, FrecencyEntry>;

function load(): FrecencyData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(data: FrecencyData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function recordAccess(id: string): void {
  const data = load();
  const existing = data[id];
  data[id] = {
    count: (existing?.count ?? 0) + 1,
    lastAccess: Date.now(),
  };
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
  return [...items].sort((a, b) => {
    const scoreA = getScore(getId(a));
    const scoreB = getScore(getId(b));
    return scoreB - scoreA;
  });
}

export function _clear(): void {
  localStorage.removeItem(STORAGE_KEY);
}
