(() => {
  const LASTFM_USER = "AnalogCyan";
  const PROFILE_URL = `https://www.last.fm/user/${encodeURIComponent(LASTFM_USER)}`;
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

  function setTrackUI(root, track, mode, profileUrl) {
    const art = root.querySelector("[data-lastfm-art]");
    const name = root.querySelector("[data-lastfm-name]");
    const artist = root.querySelector("[data-lastfm-artist]");
    const context = root.querySelector("[data-lastfm-context]");
    const link = root.querySelector("[data-lastfm-link]");
    const wave = root.querySelector("[data-lastfm-wave]");

    const safeName =
      track?.name || t("music.lastfmCapsule.unknownTrack", "Unknown track");
    const safeArtist =
      track?.artist || t("music.lastfmCapsule.unknownArtist", "Unknown artist");

    if (name) name.textContent = safeName;
    if (artist) artist.textContent = safeArtist;

    if (context) {
      if (mode === "live") {
        context.textContent = t(
          "music.lastfmCapsule.kickerLive",
          "Now playing",
        );
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
    }

    if (link) {
      const trackUrl = sanitizeHttpUrl(track?.url);
      const targetUrl = trackUrl || profileUrl;
      link.href = targetUrl;
      link.setAttribute(
        "aria-label",
        trackUrl ? `Open ${safeName} on Last.fm` : "Open profile on Last.fm",
      );
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
    } catch {
      showUnavailable(root, profileUrl);
    }
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
