// Only metadata and artist-published feed enclosures pass through this resolver.
// Audio bytes are delivered by the provider's CDN directly to the player.
const spotifyHosts = new Set(["open.spotify.com", "spotify.link", "spotify.app.link"]);
const soundCloudHosts = new Set(["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com", "on.soundcloud.com"]);
const metadataLimit = 2 * 1024 * 1024;

function safeRemote(raw, hosts) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  return url.protocol === "https:" && !url.username && !url.password && !url.port && hosts.has(url.hostname) ? url : null;
}

async function providerFetch(url, allowedHosts, signal) {
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (!safeRemote(url, allowedHosts)) throw new Error("unavailable");
    const response = await fetch(url, { signal, redirect: "manual", headers: { Accept: "*/*" } });
    if (response.status < 300 || response.status > 399) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("unavailable");
    url = new URL(location, url);
  }
  throw new Error("unavailable");
}

async function textWithin(response, limit = metadataLimit) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error([404, 410].includes(response.status) ? "unavailable" : "network");
  }
  if (Number(response.headers.get("Content-Length")) > limit) {
    await response.body?.cancel();
    throw new Error("unavailable");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("unavailable");
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally { await reader.cancel(); }
}

async function spotifyMedia(url, signal) {
  if (!safeRemote(url, spotifyHosts)) throw new Error("unavailable");
  let id = /^(?:\/intl-[a-z-]+)?\/(?:embed\/)?track\/([A-Za-z0-9]{22})\/?$/i.exec(url.pathname)?.[1];
  if (!id && url.hostname !== "open.spotify.com" && /^\/[\w-]+\/?$/.test(url.pathname)) {
    const metaURL = new URL("https://open.spotify.com/oembed");
    metaURL.searchParams.set("url", url.href);
    const metadata = JSON.parse(await textWithin(await providerFetch(metaURL, spotifyHosts, signal)));
    id = /open\.spotify\.com\/embed\/track\/([A-Za-z0-9]{22})/.exec(metadata.html)?.[1];
  }
  if (!id) throw new Error("unavailable");
  const canonicalUrl = "https://open.spotify.com/track/" + id;
  const html = await textWithin(await providerFetch("https://open.spotify.com/embed/track/" + id, spotifyHosts, signal));
  const raw = /<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
  const entity = raw && JSON.parse(raw)?.props?.pageProps?.state?.data?.entity;
  if (!entity || entity.uri !== "spotify:track:" + id) return { status: "embed-only", id, canonicalUrl };
  const title = entity.title || "";
  const artist = entity.artists?.map(artist => artist.name).filter(Boolean).join(", ") || "";
  const clip = safeRemote(entity.audioPreview?.url, new Set(["p.scdn.co"]));
  return clip && clip.pathname.startsWith("/mp3-preview/")
    ? { status: "preview", id, title, artist, canonicalUrl, mediaUrl: clip.href }
    : { status: "embed-only", id, title, artist, canonicalUrl };
}

async function soundCloudMedia(url, signal) {
  const host = url.hostname;
  // Only public track paths are resolved. Private links stay in the official player.
  if (!(host === "on.soundcloud.com" ? /^\/[\w-]+\/?$/ : /^\/[\w-]+\/[\w-]+\/?$/).test(url.pathname)) throw new Error("unavailable");
  const html = await textWithin(await providerFetch(url, soundCloudHosts, signal));
  const raw = /window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/.exec(html)?.[1];
  const sound = raw && JSON.parse(raw).find(item => item.hydratable === "sound")?.data;
  if (!sound) return { status: "embed-only" };
  const id = sound.id;
  const author = sound.user_id || sound.user?.id;
  const details = { status: "embed-only", title: sound.title || "", artist: sound.user?.username || "" };
  if (Number.isSafeInteger(id)) details.id = String(id);
  const canonical = safeRemote(sound.permalink_url, soundCloudHosts);
  if (canonical && sound.sharing === "public") details.canonicalUrl = canonical.href;
  if (sound.policy === "BLOCK" || sound.streamable === false) return { ...details, status: "blocked", reason: "restricted" };
  if (!Number.isSafeInteger(id) || !Number.isSafeInteger(author) || sound.sharing === "private") return details;
  const feedHost = new Set(["feeds.soundcloud.com"]);
  const rssURL = "https://feeds.soundcloud.com/users/soundcloud:users:" + author + "/sounds.rss";
  let rss;
  try { rss = await textWithin(await providerFetch(rssURL, feedHost, signal), 6 * 1024 * 1024); }
  catch { return details; }
  const guid = "tag:soundcloud,2010:tracks/" + id;
  for (const item of rss.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    if (/<guid\b[^>]*>([^<]*)<\/guid>/i.exec(item[1])?.[1]?.trim() !== guid) continue;
    const rawURL = /<enclosure\b[^>]*?\burl="([^"]+)"/i.exec(item[1])?.[1]?.replaceAll("&amp;", "&");
    const enclosure = safeRemote(rawURL, feedHost);
    if (!enclosure || !enclosure.pathname.startsWith("/stream/" + id + "-") || !enclosure.pathname.endsWith(".mp3")) break;
    const response = await fetch(enclosure, { signal, redirect: "manual", headers: { Range: "bytes=0-0" } });
    await response.body?.cancel();
    // The public enclosure redirects once, before the CORS-enabled download.
    const media = safeRemote(response.headers.get("location"), new Set(["cf-media.sndcdn.com", "feeds.soundcloud.com"]));
    if (response.status >= 300 && response.status < 400 && media) return { ...details, status: "downloadable", mediaUrl: media.href };
    break;
  }
  return details;
}

export async function resolveMediaRequest(request) {
  const raw = new URL(request.url).searchParams.get("url") || "";
  const hosts = new Set([...spotifyHosts, ...soundCloudHosts]);
  const url = raw.length <= 1500 && safeRemote(raw, hosts);
  const result = (data, status = 200) => Response.json(data, { status, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  if (request.method !== "GET") return result({ error: "method" }, 405);
  if (!url) return result({ error: "unsupported" }, 400);
  if (url.searchParams.has("secret_token") || /\/s-[\w-]+\/?$/.test(url.pathname)) return result({ status: "embed-only", reason: "private" });
  url.search = "";
  url.hash = "";
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 12000);
  try { return result(await (spotifyHosts.has(url.hostname) ? spotifyMedia(url, abort.signal) : soundCloudMedia(url, abort.signal))); }
  catch (error) { return result({ status: error.message === "unavailable" ? "blocked" : "embed-only", reason: error.message === "unavailable" ? "unavailable" : "network" }); }
  finally { clearTimeout(timeout); }
}
