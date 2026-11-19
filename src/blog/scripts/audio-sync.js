// Read-aloud: custom player, karaoke line, and follow-along scrolling.
//
// The word rules below are shared with the build and the narration tool
// (lib/read-aloud.js imports them), so the words narrated, hashed and
// highlighted are always the same list. Keep every SKIP entry a bare tag,
// .class or [attribute]: that is all the build's matcher understands.

export const SKIP = [
  "audio",
  "script",
  "style",
  "noscript",
  "template",
  "textarea",
  "[hidden]",
  "[aria-hidden]",
  "pre",
  "sup",
  "figure",
  "[data-footnotes]",
  "[data-read-aloud-skip]",
  ".heading-link",
  ".footnote-ref",
  ".read-aloud-player",
].join(",");

// The text the narration covers: the post title, then the post body
export const TITLE_SELECTOR = ".blog-post-header .p-name";
export const CONTENT_SELECTOR = ".blog-post-content";

export function normalize(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

// Splits a text node into words and the whitespace between them; a part is a
// word when normalize() leaves something of it
export function splitWords(text) {
  return text.split(/(\s+)/);
}

function textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.parentElement) return NodeFilter.FILTER_REJECT;
      if (node.parentElement.closest(SKIP)) return NodeFilter.FILTER_REJECT;
      return normalize(node.textContent)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function wordsOf(nodes) {
  return nodes.flatMap((node) =>
    splitWords(node.textContent).map(normalize).filter(Boolean)
  );
}

function wrapWords(nodes, spans) {
  for (const node of nodes) {
    const parts = splitWords(node.textContent);
    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (part && normalize(part)) {
        const span = document.createElement("span");
        span.textContent = part;
        fragment.appendChild(span);
        spans.push(span);
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    }
    node.replaceWith(fragment);
  }
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
}

function init() {
  const player = document.querySelector(".read-aloud-player");
  if (!player) return;
  const audio = player.querySelector("audio");
  if (!audio) return;

  const toggle = player.querySelector(".read-aloud-toggle");
  if (!toggle) return;
  const current = player.querySelector('[data-role="current"]');
  const duration = player.querySelector('[data-role="duration"]');
  const seek = player.querySelector(".read-aloud-seek");
  const dock = player.closest(".read-aloud-dock");
  // Hidden in the markup so readers without JS don't get dead controls
  dock.hidden = false;

  let karaoke = null;

  let known = false; // duration known, so seek.max is real
  let unavailable = false;

  function setDuration(seconds) {
    if (!seconds || !isFinite(seconds)) return;
    seek.max = seconds;
    duration.textContent = formatTime(seconds);
    known = true;
    describe(parseFloat(seek.value) || 0);
  }

  function describe(t) {
    if (known) {
      seek.setAttribute(
        "aria-valuetext",
        formatTime(t) + " of " + formatTime(seek.max)
      );
    }
  }

  function showTime(t) {
    if (unavailable) return;
    current.textContent = formatTime(t);
    if (!seek.matches(":active") && intendedSeek == null) {
      seek.value = t;
      describe(t);
    }
  }

  // Player controls
  toggle.addEventListener("click", () => {
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  });
  function setPlaying(playing) {
    toggle.classList.toggle("is-playing", playing);
    toggle.setAttribute(
      "aria-label",
      unavailable
        ? "The read-aloud is unavailable"
        : playing
          ? "Pause the read-aloud"
          : "Play the read-aloud"
    );
  }
  audio.addEventListener("play", () => setPlaying(true));
  audio.addEventListener("pause", () => setPlaying(false));
  audio.addEventListener("ended", () => setPlaying(false));
  audio.addEventListener("loadedmetadata", () => setDuration(audio.duration));
  function fail() {
    unavailable = true;
    setPlaying(false);
    toggle.disabled = true;
    seek.disabled = true;
    player.classList.add("is-unavailable");
    current.textContent = "Audio unavailable";
    if (karaoke) karaoke.clear();
  }
  audio.addEventListener("error", fail);
  // The error may have fired before this script ran
  if (audio.error) fail();

  // The position the listener asked for. A seek on an unloaded element
  // (no metadata yet) gets dropped by the browser, so it is remembered and
  // applied by the frame loop as soon as the media can actually seek
  let intendedSeek = null;

  function canSeekTo(time) {
    return (
      audio.seekable.length > 0 &&
      audio.seekable.end(audio.seekable.length - 1) >= time
    );
  }

  function seekTo(time) {
    if (unavailable) return;
    if (canSeekTo(time)) {
      audio.currentTime = time;
      intendedSeek = null;
    } else {
      intendedSeek = time;
      // preload="none" never fetches metadata on its own, so a seek before
      // the first play would wait forever; load() would also cancel a play()
      // that is still fetching, so only kick it while idle
      if (
        audio.readyState === 0 &&
        audio.preload === "none" &&
        audio.paused &&
        audio.networkState !== audio.NETWORK_LOADING
      ) {
        audio.preload = "metadata";
        audio.load();
      }
      startLoop();
    }
    current.textContent = formatTime(time);
    describe(time);
    if (karaoke) karaoke.paint(time);
  }

  seek.addEventListener("input", () => seekTo(parseFloat(seek.value) || 0));

  // The slider's step stays fine for pointer seeking; arrow keys jump 5 s
  const KEY_STEP = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 };
  seek.addEventListener("keydown", (e) => {
    const step = KEY_STEP[e.key];
    if (!step) return;
    e.preventDefault();
    const max = parseFloat(seek.max) || 0;
    const time = Math.min(
      max,
      Math.max(0, (parseFloat(seek.value) || 0) + step)
    );
    seek.value = time;
    seekTo(time);
  });

  function applyIntendedSeek() {
    if (intendedSeek == null || !canSeekTo(intendedSeek)) return;
    if (Math.abs(audio.currentTime - intendedSeek) >= 0.5) {
      audio.currentTime = intendedSeek;
    }
    intendedSeek = null;
    if (karaoke) karaoke.paint();
  }

  audio.addEventListener("seeked", () => {
    showTime(audio.currentTime);
    if (karaoke) karaoke.paint();
  });
  audio.addEventListener("pause", () => showTime(audio.currentTime));
  audio.addEventListener("play", () => {
    if (karaoke) karaoke.paint();
    startLoop();
  });

  // The dock is position: sticky; when it catches the top edge, nudge the
  // player's glass so it reads as floating over the text
  function stuckCheck() {
    const top = dock.getBoundingClientRect().top;
    if (top <= 16) player.classList.add("is-stuck");
    else if (top >= 24) player.classList.remove("is-stuck");
  }
  window.addEventListener("scroll", stuckCheck, { passive: true });
  stuckCheck();

  let lastShownSecond = -1;
  let rafId = 0;

  // Runs only while playing or while a seek waits for metadata
  function startLoop() {
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function frame() {
    rafId = 0;
    const t = audio.currentTime;
    const second = Math.floor(t);
    // One write per displayed second: every-frame updates force needless
    // recalc layout in Firefox on span-heavy pages
    if (second !== lastShownSecond) {
      lastShownSecond = second;
      showTime(t);
    }
    if (intendedSeek != null) applyIntendedSeek();
    if (karaoke && !audio.paused) karaoke.paint();
    if (!unavailable && (!audio.paused || intendedSeek != null)) startLoop();
  }
  startLoop();

  // The build knows the recording's length, so the slider is usable before
  // any metadata loads; the media's own duration replaces it once known
  setDuration(parseFloat(player.dataset.duration));

  // The karaoke line is optional: without timings, or with timings that no
  // longer match the text, the player still works on its own
  setupKaraoke(player, audio).then((k) => {
    karaoke = k;
    if (!k) return;
    if (!audio.paused || audio.currentTime > 0 || intendedSeek != null) {
      k.paint(intendedSeek);
    }
  });
}

async function setupKaraoke(player, audio) {
  let data;
  try {
    const response = await fetch(player.dataset.timings);
    if (!response.ok) return null;
    data = await response.json();
  } catch {
    return null;
  }
  const entries = (data.words || []).filter((entry) => normalize(entry.w));
  if (!entries.length) return null;
  const transcript = entries.map((entry) => normalize(entry.w));
  const times = entries.map((entry) => entry.t);

  const content = document.querySelector(CONTENT_SELECTOR);
  if (!content) return null;
  const title = document.querySelector(TITLE_SELECTOR);

  // Check the text against the transcript before touching the DOM. The build
  // already refused a recording of different text, so a mismatch here means
  // the page changed after load; better no line than a wrong one
  const nodes = [...(title ? textNodes(title) : []), ...textNodes(content)];
  const words = wordsOf(nodes);
  if (
    transcript.length !== words.length ||
    transcript.some((word, i) => word !== words[i])
  ) {
    console.warn("read-aloud: timings do not match the text, line disabled");
    return null;
  }
  const spans = [];
  wrapWords(nodes, spans);

  const line = document.createElement("span");
  line.className = "read-aloud-line";
  content.appendChild(line);
  let placed = false;
  let last = -1;

  // Positions relative to .blog-post-content, measured once: the per-frame
  // line movement reads this cache instead of flushing layout every frame
  let spanRects = [];
  function measureSpans() {
    const contentRect = content.getBoundingClientRect();
    spanRects = spans.map((span) => {
      const r = span.getBoundingClientRect();
      return {
        x: r.left - contentRect.left,
        y: r.top - contentRect.top,
        w: r.width,
        h: r.height,
      };
    });
  }

  function placeLine(index) {
    const rect = spanRects[index];
    // A word with no box (inside something collapsed) has nowhere to go
    if (!rect || !rect.w) return;
    const size = parseFloat(getComputedStyle(spans[index]).fontSize);
    const height = Math.max(2, Math.round(size * 0.12));
    line.style.height = height + "px";
    line.style.width = rect.w + "px";
    line.style.transform =
      "translate(" + rect.x + "px," + (rect.y + rect.h - height) + "px)";
  }

  // Late layout shifts (lazy images, font swaps, resizes) would leave the
  // cached positions stale; re-measure at most once a frame
  let remeasureQueued = false;
  function remeasure() {
    if (remeasureQueued) return;
    remeasureQueued = true;
    requestAnimationFrame(() => {
      remeasureQueued = false;
      measureSpans();
      if (last >= 0) placeLine(last);
    });
  }
  measureSpans();
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(remeasure).observe(content);
  }
  if (document.fonts && document.fonts.ready)
    document.fonts.ready.then(remeasure);
  window.addEventListener("resize", remeasure);

  // Follow-along scrolling, pausing while the reader takes over. Keys used on
  // the player itself don't count, so starting playback by keyboard follows
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let lastUserScroll = 0;
  // pointerdown covers dragging the scrollbar
  for (const event of ["wheel", "touchstart", "keydown", "pointerdown"]) {
    window.addEventListener(
      event,
      (e) => {
        if (
          (event === "keydown" || event === "pointerdown") &&
          player.contains(e.target)
        ) {
          return;
        }
        lastUserScroll = Date.now();
      },
      { passive: true }
    );
  }

  function follow(span) {
    if (audio.paused || Date.now() - lastUserScroll < 4500) return;
    const rect = span.getBoundingClientRect();
    if (!rect.width) return;
    const vh = window.innerHeight;
    if (rect.top >= vh * 0.18 && rect.bottom <= vh * 0.8) return;
    window.scrollTo({
      top: window.scrollY + rect.top - vh * 0.3,
      behavior: reducedMotion.matches ? "auto" : "smooth",
    });
  }

  function paint(at) {
    const now = at ?? audio.currentTime;
    let index = last;
    if (now < (times[last] ?? -1)) index = -1;
    while (index + 1 < times.length && times[index + 1] <= now) index += 1;
    if (index === last) return;
    if (index >= 0) {
      // First placement snaps into position invisibly; after that the line
      // glides from word to word
      if (!placed) {
        line.style.transition = "none";
        placeLine(index);
        void line.offsetWidth;
        line.style.transition = "";
        placed = true;
      } else {
        placeLine(index);
      }
      line.classList.add("is-active");
      follow(spans[index]);
    } else {
      line.classList.remove("is-active");
    }
    last = index;
  }

  function clear() {
    line.classList.remove("is-active");
  }

  return { paint, clear };
}

if (typeof document !== "undefined") init();
