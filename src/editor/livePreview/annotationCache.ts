import { parseAnnotations, type Annotation } from "../../lib/ipc";

const cache = new Map<string, Annotation[]>();

export function getAnnotationCached(text: string): Annotation[] | undefined {
  return cache.get(text);
}

export async function parseAnnotationAsync(text: string): Promise<Annotation[]> {
  const cached = cache.get(text);
  if (cached) return cached;
  const result = await parseAnnotations(text);
  cache.set(text, result);
  return result;
}

export function clearAnnotationCache(): void {
  cache.clear();
}
