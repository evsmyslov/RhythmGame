export function parseTrackLink(value) {
  let url;
  try { url = new URL(value); } catch { /* Show the same hint for incomplete links. */ }
  if (url?.protocol !== "https:" || url.username || url.password) {
    throw new Error("Вставь полную ссылку на трек, начиная с https://.");
  }
  if (/(^|\.)dropbox\.com$/i.test(url.hostname)) {
    url.searchParams.delete("dl");
    url.searchParams.set("raw", "1");
  }
  return url;
}

export function streamingReference(value) {
  let url;
  try { url = parseTrackLink(value); } catch { return null; }
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (["youtu.be", "youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)) {
    const id = host === "youtu.be" ? parts[0] : parts[0] === "watch" ? url.searchParams.get("v")
      : ["shorts", "live", "embed"].includes(parts[0]) ? parts[1] : "";
    if (/^[\w-]{11}$/.test(id ?? "")) return { provider: "YouTube", id, url: "https://www.youtube.com/watch?v=" + id };
  }
  if (host === "open.spotify.com") {
    if (parts[0]?.startsWith("intl-")) parts.shift();
    if (parts[0] === "embed") parts.shift();
    if (parts[0] === "track" && /^[A-Za-z0-9]{22}$/.test(parts[1])) {
      return { provider: "Spotify", id: parts[1], url: "https://open.spotify.com/track/" + parts[1] };
    }
  }
  if (["spotify.link", "spotify.app.link"].includes(host) && /^[\w-]+$/.test(parts[0] ?? "")) {
    return { provider: "Spotify", url: url.href };
  }
  if ((["soundcloud.com", "m.soundcloud.com"].includes(host) && parts.length >= 2 && !["sets", "tracks", "albums"].includes(parts[1])) ||
      (host === "on.soundcloud.com" && parts.length === 1)) {
    return { provider: "SoundCloud", url: url.href };
  }
  return null;
}

export function linkedMedia(html, pageURL) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const base = doc.querySelector("base[href]")?.getAttribute("href");
  const nodes = doc.querySelectorAll('audio[src], audio source[src], meta[property^="og:audio"], video[src], video source[src], link[as="audio"][href]');
  for (const node of nodes) {
    if (node.matches('meta') && !["og:audio", "og:audio:url", "og:audio:secure_url"].includes(node.getAttribute("property"))) continue;
    const source = node.getAttribute("src") || node.getAttribute("content") || node.getAttribute("href");
    if (!source?.trim()) continue;
    try { return parseTrackLink(new URL(source, new URL(base || pageURL, pageURL)).href); }
    catch { /* Check the next published media source. */ }
  }
  return null;
}
