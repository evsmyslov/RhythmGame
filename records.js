const prefix = "ritm-best-v1:";

function storageKey(track) {
  return prefix + track.songId + ":" + track.difficulty;
}

export function readBest(track) {
  try {
    const record = JSON.parse(localStorage.getItem(storageKey(track)));
    if (Number.isSafeInteger(record?.score) && record.score > 0) return record;
  } catch { /* Storage can be unavailable. */ }
  return null;
}

export function finishRecord(track, score) {
  const previous = readBest(track);
  if (!score || score <= (previous?.score ?? 0)) {
    return { best: previous, improved: false, saved: Boolean(previous) };
  }
  try {
    localStorage.setItem(storageKey(track), JSON.stringify({ score }));
    return { best: { score }, improved: true, saved: true };
  } catch {
    return { best: previous, improved: false, saved: false };
  }
}
