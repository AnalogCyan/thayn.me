import { sanitizeExternalUrl } from "../../lib/sanitize-url.js";

const LASTFM_API_BASE = "https://ws.audioscrobbler.com/2.0/";
const DEFAULT_USER = "AnalogCyan";
const BROWSER_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const CDN_CACHE_CONTROL_OK =
  "public, max-age=20, stale-while-revalidate=120, durable";
const CDN_CACHE_CONTROL_ERROR = "public, max-age=5, stale-while-revalidate=20";

function isAllowedLastfmHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "last.fm" || host.endsWith(".last.fm");
}

function sanitizeLastfmTrackUrl(value) {
  const safe = sanitizeExternalUrl(value);
  if (!safe) return "";

  try {
    const parsed = new URL(safe);
    if (!isAllowedLastfmHost(parsed.hostname)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export const config = {
  path: "/.netlify/functions/lastfm-now-playing",
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};

function pickImage(track) {
  const images = Array.isArray(track?.image) ? track.image : [];
  for (let i = images.length - 1; i >= 0; i -= 1) {
    const candidate = String(images[i]?.["#text"] || "").trim();
    if (candidate) return candidate;
  }
  return "";
}

function normalizeTrack(track) {
  if (!track || typeof track !== "object") return null;

  const album = String(track.album?.["#text"] || "").trim();
  const artist = String(track.artist?.["#text"] || "").trim();
  const name = String(track.name || "").trim();
  const url = sanitizeLastfmTrackUrl(track.url);
  const image = toImageCdnPath(sanitizeExternalUrl(pickImage(track)));
  const dateUts = Number.parseInt(String(track.date?.uts || ""), 10);

  return {
    name,
    artist,
    album,
    url,
    image,
    dateUts: Number.isFinite(dateUts) ? dateUts : null,
  };
}

function toImageCdnPath(remoteUrl) {
  if (!remoteUrl) return "";
  const params = new URLSearchParams({
    url: remoteUrl,
    fit: "cover",
    w: "160",
    h: "160",
  });
  return `/.netlify/images?${params.toString()}`;
}

function json(statusCode, payload, cdnCacheControl) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": BROWSER_CACHE_CONTROL,
  };
  if (cdnCacheControl) {
    headers["Netlify-CDN-Cache-Control"] = cdnCacheControl;
  }
  return {
    statusCode,
    headers,
    body: JSON.stringify(payload),
  };
}

export const handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { Allow: "GET" },
      body: "Method Not Allowed",
    };
  }

  const apiKey = String(process.env.LASTFM_API_KEY || "").trim();
  if (!apiKey) {
    return json(
      503,
      { error: "Last.fm API not configured" },
      CDN_CACHE_CONTROL_ERROR,
    );
  }

  // Locked to site owner profile to avoid exposing this endpoint as a general API proxy.
  const user = DEFAULT_USER;
  const upstreamUrl = new URL(LASTFM_API_BASE);
  upstreamUrl.searchParams.set("method", "user.getrecenttracks");
  upstreamUrl.searchParams.set("user", user);
  upstreamUrl.searchParams.set("api_key", apiKey);
  upstreamUrl.searchParams.set("format", "json");
  upstreamUrl.searchParams.set("limit", "8");

  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!upstream.ok) {
      return json(
        502,
        { error: "Last.fm upstream request failed" },
        CDN_CACHE_CONTROL_ERROR,
      );
    }

    const payload = await upstream.json();
    const rawTracks = payload?.recenttracks?.track;
    const tracks = (Array.isArray(rawTracks) ? rawTracks : [])
      .map(normalizeTrack)
      .filter(Boolean);

    const firstRaw = Array.isArray(rawTracks) ? rawTracks[0] : null;
    const firstTrack = tracks[0] || null;
    const isNowPlaying =
      String(firstRaw?.["@attr"]?.nowplaying || "") === "true";

    const nowPlayingTrack = isNowPlaying ? firstTrack : null;
    const recentTracks = isNowPlaying ? tracks.slice(1) : tracks;

    return json(
      200,
      {
        user,
        profileUrl: `https://www.last.fm/user/${encodeURIComponent(user)}`,
        nowPlaying: {
          active: isNowPlaying,
          track: nowPlayingTrack,
        },
        recent: recentTracks,
      },
      CDN_CACHE_CONTROL_OK,
    );
  } catch {
    return json(
      502,
      { error: "Last.fm fetch failed" },
      CDN_CACHE_CONTROL_ERROR,
    );
  }
};
