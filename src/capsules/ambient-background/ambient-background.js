(function () {
  function init() {
    try {
      var nodes = document.querySelectorAll(".gradient-node");
      if (!nodes.length) return;

      var prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

      var vw = window.innerWidth;
      var vh = window.innerHeight;

      // Node CSS sizes: 40lvh, 50lvh, 45lvh, 60lvh
      var nodeSizesLVH = [0.4, 0.5, 0.45, 0.6];
      // gradient-background: top: -10lvh, height: 120lvh, left: 0, width: 100%
      var containerTop = -0.1 * vh;
      var containerHeight = 1.2 * vh;

      var style = document.getElementById("ambient-bg-style");
      if (!style) {
        style = document.createElement("style");
        style.id = "ambient-bg-style";
        document.head.appendChild(style);
      }
      var css = "";

      for (var i = 0; i < nodes.length; i++) {
        var nodeSize = vh * nodeSizesLVH[i];
        var maxX = vw - nodeSize;
        var maxY = containerHeight - nodeSize;

        var startX = Math.random() * maxX;
        var startY = Math.random() * maxY + containerTop;

        nodes[i].style.transform =
          "translate3d(" + startX + "px," + startY + "px, 0)";

        if (!prefersReducedMotion) {
          var duration = 18 + Math.random() * 14;
          var deviation = 0.16 * Math.min(vw, vh);

          var wp = [];
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

          var name = "ambient-float-" + i;

          css +=
            "@keyframes " +
            name +
            " { 0%,100% { transform: translate3d(" +
            startX +
            "px," +
            startY +
            "px,0) scale(" +
            wp[0].scale +
            "); } 25% { transform: translate3d(" +
            wp[1].x +
            "px," +
            wp[1].y +
            "px,0) scale(" +
            wp[1].scale +
            "); } 50% { transform: translate3d(" +
            wp[2].x +
            "px," +
            wp[2].y +
            "px,0) scale(" +
            wp[2].scale +
            "); } 75% { transform: translate3d(" +
            wp[3].x +
            "px," +
            wp[3].y +
            "px,0) scale(" +
            wp[3].scale +
            "); } }";

          nodes[i].style.animation =
            name + " " + duration + "s ease-in-out infinite";
        }
      }

      if (css) {
        style.textContent = css;
      }
    } catch (e) {
      // fail silently
    }
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  init();
  window.addEventListener("resize", init);
})();
