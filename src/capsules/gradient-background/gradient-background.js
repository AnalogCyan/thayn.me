// Randomizes gradient node positions and animations
// Caches per theme and viewport in sessionStorage so navigation does not reshuffle

(function () {
  var initialized = false;
  var STORAGE_KEY = "gradient_cfg";

  function getTheme() {
    var root = document.documentElement;
    if (root.classList.contains("light-theme")) return "light";
    if (root.classList.contains("dark-theme")) return "dark";
    return "system";
  }

  function saveConfig(config) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // ignore
    }
  }

  function loadConfig() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var config = JSON.parse(raw);
      if (config.theme !== getTheme()) return null;
      return config;
    } catch {
      return null;
    }
  }

  function init() {
    if (initialized) return;
    var root = document.querySelector('[data-capsule="gradient-background"]');
    if (!root || root.dataset.animated !== "true") return;
    try {
      var nodes = document.querySelectorAll(".gradient-node");
      if (!nodes.length) return;

      var prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

      var vw = window.innerWidth;
      var vh = window.innerHeight;

      var nodeSizesLVH = [0.4, 0.5, 0.45, 0.6];
      var containerTop = -0.1 * vh;
      var containerHeight = 1.2 * vh;

      var config = loadConfig();
      if (config && (config.vw !== vw || config.vh !== vh)) {
        config = null;
      }

      var nodeData = [];

      for (var i = 0; i < nodes.length; i++) {
        var nodeSize = vh * nodeSizesLVH[i];
        var maxX = vw - nodeSize;
        var maxY = containerHeight - nodeSize;

        var startX, startY, duration, wp;

        if (config && config.nodes && config.nodes[i]) {
          var saved = config.nodes[i];
          startX = saved.startX;
          startY = saved.startY;
          duration = saved.duration;
          wp = saved.wp;
        } else {
          startX = Math.random() * maxX;
          startY = Math.random() * maxY + containerTop;
          duration = 18 + Math.random() * 14;
          var deviation = 0.16 * Math.min(vw, vh);
          wp = [];
          for (var k = 0; k < 4; k++) {
            wp.push({
              x: clamp(startX + (Math.random() - 0.5) * 2 * deviation, 0, maxX),
              y: clamp(
                startY + (Math.random() - 0.5) * 2 * deviation,
                containerTop,
                containerTop + maxY
              ),
              scale: 1.3 + Math.random() * 0.5,
            });
          }
        }

        nodes[i].style.transform =
          "translate3d(" + startX + "px," + startY + "px, 0)";

        if (!prefersReducedMotion) {
          // Waypoints feed the shared @keyframes in the stylesheet. CSSOM
          // writes are exempt from CSP, so no <style> element is needed.
          // The first keyframe starts from the resting spot, not waypoint 0.
          var s = nodes[i].style;
          s.setProperty("--float-x0", startX + "px");
          s.setProperty("--float-y0", startY + "px");
          for (var w = 0; w < 4; w++) {
            if (w > 0) {
              s.setProperty("--float-x" + w, wp[w].x + "px");
              s.setProperty("--float-y" + w, wp[w].y + "px");
            }
            s.setProperty("--float-s" + w, wp[w].scale);
          }
          s.animation = "ambient-float " + duration + "s ease-in-out infinite";
        }

        nodeData.push({
          startX: startX,
          startY: startY,
          duration: duration,
          wp: wp,
        });
      }

      if (!config) {
        saveConfig({
          theme: getTheme(),
          vw: vw,
          vh: vh,
          nodes: nodeData,
        });
      }

      initialized = true;
    } catch {
      // fail silently
    }
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  init();
})();
