(() => {
  const LASTFM_USER = "AnalogCyan";
  const PROFILE_URL = `https://www.last.fm/user/${encodeURIComponent(LASTFM_USER)}`;
  const DEFAULT_REFRESH_INTERVAL_MS = 4 * 60 * 1000;
  const MIN_REFRESH_INTERVAL_MS = 75 * 1000;
  const MAX_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
  const VIZ_TICK_MS = 220;
  let recentListIdCounter = 0;

  function isAllowedLastfmHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return host === "last.fm" || host.endsWith(".last.fm");
  }

  function assignRecentControlsId(root) {
    const toggle = root.querySelector("[data-lastfm-toggle]");
    const recentList = root.querySelector("[data-lastfm-recent-list]");
    if (!toggle || !recentList) return;

    if (!recentList.id) {
      recentListIdCounter += 1;
      recentList.id = `lastfm-recent-list-${recentListIdCounter}`;
    }

    toggle.setAttribute("aria-controls", recentList.id);
  }

  function sanitizeHttpUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;

    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      if (!isAllowedLastfmHost(parsed.hostname)) {
        return null;
      }
      return parsed.toString();
    } catch {
      return null;
    }
  }

  function t(key, fallback) {
    if (window.JG_I18N && typeof window.JG_I18N.t === "function") {
      return window.JG_I18N.t(key, fallback);
    }
    return fallback;
  }

  function formatRelativeTime(unixSeconds) {
    if (!unixSeconds) return "";
    const ms = Number(unixSeconds) * 1000;
    if (!Number.isFinite(ms)) return "";

    const deltaSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (deltaSec < 60) return t("music.lastfmCapsule.justNow", "just now");

    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    if (deltaSec < 3600)
      return rtf.format(-Math.round(deltaSec / 60), "minute");
    if (deltaSec < 86400)
      return rtf.format(-Math.round(deltaSec / 3600), "hour");
    return rtf.format(-Math.round(deltaSec / 86400), "day");
  }

  function applyVisualizerColorFromImage(root, imageEl) {
    if (!root || !imageEl) return;
    try {
      const w = Math.max(1, Math.min(imageEl.naturalWidth || 0, 32));
      const h = Math.max(1, Math.min(imageEl.naturalHeight || 0, 32));
      if (!w || !h) return;

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(imageEl, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;

      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha < 40) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count += 1;
      }
      if (count === 0) return;

      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);

      const boost = 1.08;
      const rr = Math.min(255, Math.round(r * boost));
      const gg = Math.min(255, Math.round(g * boost));
      const bb = Math.min(255, Math.round(b * boost));
      const adjusted = ensureThemeContrast(root, { r: rr, g: gg, b: bb });
      root.style.setProperty(
        "--lastfm-viz-color",
        `rgb(${adjusted.r} ${adjusted.g} ${adjusted.b})`,
      );
    } catch {
      // Ignore color sampling failures and keep default accent color.
    }
  }

  function parseColorToRgba(colorText) {
    const raw = String(colorText || "").trim();
    if (!raw) return null;

    const probe = document.createElement("span");
    probe.style.backgroundColor = raw;
    probe.style.display = "none";
    document.body.append(probe);
    const computed = getComputedStyle(probe).backgroundColor;
    probe.remove();

    const match = computed.match(
      /rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?/i,
    );
    if (!match) return null;
    return {
      r: Math.max(0, Math.min(255, Math.round(Number(match[1])))),
      g: Math.max(0, Math.min(255, Math.round(Number(match[2])))),
      b: Math.max(0, Math.min(255, Math.round(Number(match[3])))),
      a: match[4] == null ? 1 : Math.max(0, Math.min(1, Number(match[4]))),
    };
  }

  function compositeOver(fg, bg) {
    const alpha = Math.max(0, Math.min(1, Number(fg?.a ?? 1)));
    return {
      r: Math.round(fg.r * alpha + bg.r * (1 - alpha)),
      g: Math.round(fg.g * alpha + bg.g * (1 - alpha)),
      b: Math.round(fg.b * alpha + bg.b * (1 - alpha)),
    };
  }

  function luminance(rgb) {
    const chan = [rgb.r, rgb.g, rgb.b].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
  }

  function contrastRatio(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    const lighter = Math.max(la, lb);
    const darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function shiftColor(rgb, towardWhite, amount) {
    const mix = towardWhite ? 255 : 0;
    return {
      r: Math.round(rgb.r + (mix - rgb.r) * amount),
      g: Math.round(rgb.g + (mix - rgb.g) * amount),
      b: Math.round(rgb.b + (mix - rgb.b) * amount),
    };
  }

  function getEffectiveSurfaceColor(root) {
    const htmlStyles = getComputedStyle(document.documentElement);
    const pageBg =
      parseColorToRgba(htmlStyles.getPropertyValue("--page-bg")) ||
      parseColorToRgba(getComputedStyle(document.documentElement).backgroundColor) ||
      { r: 240, g: 240, b: 240, a: 1 };

    const rootBg = parseColorToRgba(getComputedStyle(root).backgroundColor);
    if (rootBg && rootBg.a > 0) {
      return compositeOver(rootBg, pageBg);
    }

    const bgMain =
      parseColorToRgba(htmlStyles.getPropertyValue("--bg-main")) ||
      parseColorToRgba(htmlStyles.getPropertyValue("--bg-secondary"));
    if (bgMain) {
      return compositeOver(bgMain, pageBg);
    }

    return { r: pageBg.r, g: pageBg.g, b: pageBg.b };
  }

  function pickStrongContrastFallback(root, surface) {
    const htmlStyles = getComputedStyle(document.documentElement);
    const candidates = [
      parseColorToRgba(htmlStyles.getPropertyValue("--accent")),
      parseColorToRgba(htmlStyles.getPropertyValue("--text")),
      { r: 255, g: 255, b: 255, a: 1 },
      { r: 0, g: 0, b: 0, a: 1 },
    ].filter(Boolean);

    let best = { r: 0, g: 153, b: 255 };
    let bestRatio = contrastRatio(best, surface);
    candidates.forEach((candidate) => {
      const rgb = { r: candidate.r, g: candidate.g, b: candidate.b };
      const ratio = contrastRatio(rgb, surface);
      if (ratio > bestRatio) {
        best = rgb;
        bestRatio = ratio;
      }
    });
    return best;
  }

  function ensureThemeContrast(root, sampled) {
    const surface = getEffectiveSurfaceColor(root);
    const targetRatio = 4;
    if (contrastRatio(sampled, surface) >= targetRatio) return sampled;

    const bgLum = luminance(surface);
    const sampleLum = luminance(sampled);
    const towardWhite = sampleLum <= bgLum;

    let best = sampled;
    for (let i = 1; i <= 20; i += 1) {
      const candidate = shiftColor(sampled, towardWhite, i / 20);
      best = candidate;
      if (contrastRatio(candidate, surface) >= targetRatio) break;
    }

    if (contrastRatio(best, surface) >= targetRatio) return best;
    return pickStrongContrastFallback(root, surface);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function computeRefreshIntervalMs(recentTracks) {
    if (!Array.isArray(recentTracks) || recentTracks.length < 2) {
      return DEFAULT_REFRESH_INTERVAL_MS;
    }

    const deltas = [];
    for (let i = 0; i < recentTracks.length - 1; i += 1) {
      const newer = Number(recentTracks[i]?.dateUts);
      const older = Number(recentTracks[i + 1]?.dateUts);
      if (!Number.isFinite(newer) || !Number.isFinite(older)) continue;
      const deltaSec = newer - older;
      if (deltaSec < 30 || deltaSec > 1200) continue;
      deltas.push(deltaSec);
    }

    if (deltas.length === 0) return DEFAULT_REFRESH_INTERVAL_MS;
    const sorted = deltas.slice().sort((a, b) => a - b);
    const trimCount = sorted.length >= 6 ? Math.floor(sorted.length * 0.2) : 0;
    const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
    const pool = trimmed.length > 0 ? trimmed : sorted;
    const avgSec = pool.reduce((sum, n) => sum + n, 0) / pool.length;
    return clamp(
      Math.round(avgSec * 1000),
      MIN_REFRESH_INTERVAL_MS,
      MAX_REFRESH_INTERVAL_MS,
    );
  }

  function stopVisualizer(root) {
    if (root.__lastfmVizTimer) {
      window.clearInterval(root.__lastfmVizTimer);
      root.__lastfmVizTimer = null;
    }

    const bars = root.querySelectorAll("[data-lastfm-wave] span");
    bars.forEach((bar) => {
      bar.style.height = "10px";
    });
  }

  function startVisualizer(root) {
    const bars = Array.from(root.querySelectorAll("[data-lastfm-wave] span"));
    if (bars.length === 0) return;

    stopVisualizer(root);
    let phase = Math.random() * Math.PI * 2;

    const tick = () => {
      phase += 0.42;
      bars.forEach((bar, idx) => {
        const base = 8;
        const swing = Math.abs(Math.sin(phase + idx * 0.9)) * 12;
        const jitter = Math.random() * 4;
        const px = Math.max(8, Math.min(24, Math.round(base + swing + jitter)));
        bar.style.height = `${px}px`;
      });
    };

    tick();
    root.__lastfmVizTimer = window.setInterval(tick, VIZ_TICK_MS);
  }

  function setTrackUI(root, track, mode, profileUrl) {
    const art = root.querySelector("[data-lastfm-art]");
    const trackLink = root.querySelector("[data-lastfm-track-link]");
    const name = root.querySelector("[data-lastfm-name]");
    const artist = root.querySelector("[data-lastfm-artist]");
    const context = root.querySelector("[data-lastfm-context]");
    const profileLink = root.querySelector("[data-lastfm-link]");
    const wave = root.querySelector("[data-lastfm-wave]");

    const safeName =
      track?.name || t("music.lastfmCapsule.unknownTrack", "Unknown track");
    const safeArtist =
      track?.artist || t("music.lastfmCapsule.unknownArtist", "Unknown artist");

    if (name) name.textContent = safeName;
    if (artist) artist.textContent = safeArtist;

    if (context) {
      if (mode === "live") {
        context.textContent = "";
      } else {
        context.textContent = formatRelativeTime(track?.dateUts);
      }
    }

    if (art) {
      art.src = track?.image || "/media/logo.svg";
      art.alt = `${safeName} album art`;
      art.onerror = () => {
        art.src = "/media/logo.svg";
      };
      art.onload = () => {
        applyVisualizerColorFromImage(root, art);
      };
      if (art.complete && art.naturalWidth > 0) {
        applyVisualizerColorFromImage(root, art);
      }
    }

    const trackUrl = sanitizeHttpUrl(track?.url);
    const targetUrl = trackUrl || profileUrl;
    if (trackLink) {
      trackLink.href = targetUrl;
      trackLink.setAttribute(
        "aria-label",
        trackUrl ? `Open ${safeName} on Last.fm` : "Open profile on Last.fm",
      );
    }
    if (profileLink) {
      profileLink.href = profileUrl;
      profileLink.setAttribute("aria-label", "Open profile on Last.fm");
    }

    if (wave) {
      const live = mode === "live";
      wave.hidden = !live;
      wave.classList.toggle("is-active", live);
    }
  }

  function setWaveVisible(root, visible) {
    const wave = root.querySelector("[data-lastfm-wave]");
    if (!wave) return;
    wave.hidden = !visible;
    wave.classList.toggle("is-active", visible);
    if (visible) {
      startVisualizer(root);
    } else {
      stopVisualizer(root);
    }
  }

  function setToggleVisible(root, visible) {
    const toggle = root.querySelector("[data-lastfm-toggle]");
    if (!toggle) return;
    toggle.hidden = !visible;
    if (!visible) {
      toggle.setAttribute("aria-expanded", "false");
    }
  }

  function renderRecentList(root, tracks, profileUrl) {
    const recentList = root.querySelector("[data-lastfm-recent-list]");
    if (!recentList) return;

    recentList.innerHTML = "";
    tracks.slice(0, 10).forEach((track) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      const name =
        track.name || t("music.lastfmCapsule.unknownTrack", "Unknown track");
      const artist =
        track.artist ||
        t("music.lastfmCapsule.unknownArtist", "Unknown artist");
      const when = formatRelativeTime(track.dateUts);

      link.href = sanitizeHttpUrl(track.url) || profileUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = when
        ? `${name} · ${artist} · ${when}`
        : `${name} · ${artist}`;

      item.append(link);
      recentList.append(item);
    });
  }

  function setRecentOpen(root, open) {
    const toggle = root.querySelector("[data-lastfm-toggle]");
    const recent = root.querySelector("[data-lastfm-recent]");
    if (!toggle || !recent) return;

    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    recent.hidden = !open;
  }

  function setIdleMode(root, tracks, profileUrl) {
    if (!Array.isArray(tracks) || tracks.length === 0) {
      setToggleVisible(root, false);
      setWaveVisible(root, false);
      setRecentOpen(root, false);
      return;
    }

    setWaveVisible(root, false);
    setTrackUI(root, tracks[0], "idle", profileUrl);
    renderRecentList(root, tracks, profileUrl);

    const toggle = root.querySelector("[data-lastfm-toggle]");
    if (toggle) {
      setToggleVisible(root, true);
      if (toggle.dataset.bound !== "true") {
        toggle.dataset.bound = "true";
        toggle.addEventListener("click", () => {
          const isOpen = toggle.getAttribute("aria-expanded") === "true";
          setRecentOpen(root, !isOpen);
        });
      }
    }

    setRecentOpen(root, false);
  }

  function setLiveMode(root, track, profileUrl) {
    setToggleVisible(root, false);
    setWaveVisible(root, true);
    setRecentOpen(root, false);
    setTrackUI(root, track, "live", profileUrl);
  }

  function showUnavailable(root, profileUrl) {
    setToggleVisible(root, false);
    setWaveVisible(root, false);
    setRecentOpen(root, false);

    setTrackUI(
      root,
      {
        name: t("music.lastfmCapsule.error", "Unavailable"),
        artist: t(
          "music.lastfmCapsule.errorBody",
          "Could not load Last.fm right now. Try again in a bit.",
        ),
        image: "/media/logo.svg",
        url: profileUrl,
      },
      "idle",
      profileUrl,
    );

    const context = root.querySelector("[data-lastfm-context]");
    if (context) context.textContent = "";
  }

  async function loadForCapsule(root) {
    if (!root || root.dataset.lastfmInit === "true") return;
    root.dataset.lastfmInit = "true";

    const profileUrl = PROFILE_URL;
    assignRecentControlsId(root);
    root.__lastfmRefreshMs = DEFAULT_REFRESH_INTERVAL_MS;

    setTrackUI(
      root,
      {
        name: "Loading Last.fm…",
        artist: "",
        image: "/media/logo.svg",
        url: profileUrl,
      },
      "idle",
      profileUrl,
    );

    setToggleVisible(root, false);
    setWaveVisible(root, false);
    setRecentOpen(root, false);

    const refresh = async () => {
      if (root.__lastfmRefreshing) return;
      root.__lastfmRefreshing = true;
      try {
        const response = await fetch("/.netlify/functions/lastfm-now-playing");
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data && data.error ? data.error : "Last.fm request failed",
          );
        }

        const nowPlaying = data?.nowPlaying?.active === true;
        const liveTrack = data?.nowPlaying?.track || null;
        const recentTracks = Array.isArray(data?.recent) ? data.recent : [];
        const dataProfileUrl = sanitizeHttpUrl(data?.profileUrl) || profileUrl;
        root.__lastfmRefreshMs = computeRefreshIntervalMs(recentTracks);

        if (nowPlaying && liveTrack) {
          setLiveMode(root, liveTrack, dataProfileUrl);
          return;
        }

        const idleTracks = recentTracks.slice(0, 10);
        if (idleTracks.length === 0) {
          showUnavailable(root, dataProfileUrl);
          return;
        }

        setIdleMode(root, idleTracks, dataProfileUrl);
      } finally {
        root.__lastfmRefreshing = false;
      }
    };

    try {
      await refresh();
    } catch {
      showUnavailable(root, profileUrl);
    }

    const scheduleNextRefresh = () => {
      if (root.__lastfmRefreshTimer) {
        window.clearTimeout(root.__lastfmRefreshTimer);
      }
      const delay =
        Number(root.__lastfmRefreshMs) || DEFAULT_REFRESH_INTERVAL_MS;
      root.__lastfmRefreshTimer = window.setTimeout(async () => {
        try {
          await refresh();
        } catch {
          showUnavailable(root, profileUrl);
        }
        scheduleNextRefresh();
      }, delay);
    };

    scheduleNextRefresh();
  }

  function init() {
    document
      .querySelectorAll('[data-capsule="lastfm-capsule"]')
      .forEach((root) => loadForCapsule(root));
  }

  document.addEventListener("th-i18n-ready", init, { once: true });
  if (!window.JG_I18N) {
    init();
  }
})();
