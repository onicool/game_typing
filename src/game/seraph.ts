import { getChapter } from '../content/chapters';
import { SERAPH_VERSION } from './battle';
import { PLACES } from './journey';
import { isProgress, type Progress } from './progress';

/** Separate reversible lane: a chapter's normal clear permits its hard replay. */
export const SERAPH_PROGRESS_KEY = 'angel.seraph-progress';
export const SERAPH_ROUTE_VERSIONS = Object.fromEntries(PLACES.flatMap((p, i) => getChapter(i) ? [[p.key, SERAPH_VERSION]] : []));
/** Never downgrade a future hard lane or reinterpret an unimplemented chapter. */
export const isSeraphProgress = (v: unknown): v is Progress => isProgress(v)
  && Object.entries(v.places).every(([key, p]) => Object.hasOwn(SERAPH_ROUTE_VERSIONS, key) && p.routeVersion <= SERAPH_VERSION);
export function canPlaySeraph(place: number, normal: Progress, versions: Record<string, number>): boolean {
  const chapter = getChapter(place);
  if (!chapter) return false;
  const proof = normal.places[chapter.key];
  return !!proof && proof.routeVersion === versions[chapter.key] && proof.current.cleared === true;
}
