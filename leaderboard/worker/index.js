// Player credentials are generated on the device. Only their hashes are stored.
const charts = new Set(["glass-ferry", "copper-wire", "night-market", "red-shift", "ion-storm"]);
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store"
};
const json = (value, status = 200) => Response.json(value, { status, headers });

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (path === "/") return json({ name: "Pulsewake Scores", maps: Array.from(charts) });
    const match = /^\/v1\/maps\/([a-z-]+)\/scores$/.exec(path);
    if (!match || !charts.has(match[1])) return json({ error: "unknown_map" }, 404);
    const map = match[1];
    if (request.method === "POST") {
      const token = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get("Authorization") || "")?.[1];
      if (!token) return json({ error: "player_required" }, 401);
      if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "expected_json" }, 415);
      if (Number(request.headers.get("content-length")) > 512) return json({ error: "too_large" }, 413);
      const reader = request.body?.getReader();
      if (!reader) return json({ error: "empty" }, 400);
      const data = new Uint8Array(512);
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (length + chunk.value.length > data.length) { await reader.cancel(); return json({ error: "too_large" }, 413); }
        data.set(chunk.value, length);
        length += chunk.value.length;
      }
      let entry;
      try { entry = JSON.parse(new TextDecoder().decode(data.subarray(0, length))); } catch { return json({ error: "invalid_json" }, 400); }
      const name = typeof entry?.name === "string" ? entry.name.trim() : "";
      if (!/^[\p{L}\p{N} _.-]{1,22}$/u.test(name) || !Number.isSafeInteger(entry.score) ||
          entry.score < 1 || entry.score > 1500000) return json({ error: "invalid_score" }, 400);
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      const player = Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, "0")).join("");
      await env.DB.prepare(`INSERT INTO scores (map, player, name, score) VALUES (?, ?, ?, ?)
        ON CONFLICT (map, player) DO UPDATE SET name=excluded.name, score=excluded.score
        WHERE excluded.score >= scores.score`).bind(map, player, name, entry.score).run();
    } else if (request.method !== "GET") return json({ error: "method" }, 405);
    const rows = await env.DB.prepare("SELECT name, score FROM scores WHERE map = ? ORDER BY score DESC, player ASC LIMIT 20").bind(map).all();
    return json({ scores: rows.results });
  }
};
