/* Helpers for the `{source}:{id}` study/run keys the API dispatches on. */

export function splitKey(key: string): { source: string; id: string } {
  const i = key.indexOf(':');
  if (i === -1) return { source: 'omd', id: key };
  return { source: key.slice(0, i), id: key.slice(i + 1) };
}

/** The bare id (no source prefix), for display in titles / breadcrumbs. */
export function keyLabel(key: string): string {
  return splitKey(key).id || key;
}

/** Short form of a long run id for inline metadata. */
export function shortRun(runId: string): string {
  const id = splitKey(runId).id;
  return id.length <= 28 ? id : `${id.slice(0, 12)}…${id.slice(-8)}`;
}
