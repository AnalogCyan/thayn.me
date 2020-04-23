function generateIcon(emoji) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const t1 = document.createElementNS("http://www.w3.org/2000/svg", "text");
  t1.setAttribute('y', '.9em');
  t1.setAttribute('font-size', '90');
  t1.textContent = emoji;
  svg.appendChild(t1);

  link.href = 'data:image/svg+xml,' + svg.outerHTML.replace(/"/ig, '%22');
}
