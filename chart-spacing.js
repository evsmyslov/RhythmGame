// Preserve each attack time. Move a gesture sideways when its lane is still occupied.
const recovery = [.50, .45, .40, .36, .33];

export function spaceGestures(notes, difficulty) {
  const readyAt = [0, 0, 0, 0];
  const result = [];
  for (const note of notes) {
    const points = note.path || [note];
    const preferred = note.lane;
    let best, bestCost = Infinity;
    for (let start = 0; start < 4; start++) {
      for (const direction of [1, -1]) {
        const lanes = points.map(point => start + direction * (point.lane - preferred));
        if (lanes.some((lane, i) => lane < 0 || lane > 3 || readyAt[lane] > points[i].time + 1e-6)) continue;
        const cost = Math.abs(start - preferred) * 2 + (direction === -1 ? 1 : 0);
        if (cost < bestCost) { best = lanes; bestCost = cost; }
      }
    }
    if (!best) continue;
    const path = points.map((point, i) => {
      readyAt[best[i]] = point.time + recovery[difficulty - 1];
      return { ...point, lane: best[i] };
    });
    result.push(note.path ? { ...note, lane: best[0], path } : path[0]);
  }
  return result;
}
