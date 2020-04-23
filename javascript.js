// Hey look, this is what's in the thayn.me JavaScript file!
// If you got here from the site footer, below is a list of all the quotes that can show up there!

var quotes = [
  'Are you ready to embrace uncertainty?',
  'Are you ready to embrace uncertainty?',
  '<a href="https://slimegirls.bandcamp.com/album/vacation-wasteland-ep" target="_blank" rel="noopener">Please listen kindly.</a>',
  '<a href="https://youtu.be/Yw6u6YkTgQ4" target="_blank" rel="noopener">Hello, World!</a>',
  'Keep it simple, stupid!',
  '<a href="./javascript.js" target="_blank">Now with JavaScript!</a>',
  '<i class="fab fa-html5"></i> <i class="fab fa-css3-alt"></i> <i class="fab fa-js-square"></i> <i class="fab fa-font-awesome"></i>',
  '<a href="https://en.wikipedia.org/wiki/Dieter_Rams#%22Good_design%22_principles" target="_blank" rel="noopener">Good design is...</a>',
  'DFTBA',
  'Don\'t forget to be awesome.',
  'Darling, fetch the battle axe.',
  '<a href="./.well-known/humans.txt">Run by humans (probably).</a>'
];

window.onload = function load() {
  randAvatar();
  newQuote();

  setInterval(() => {
    randAvatar();
  }, 2500);

}

function randAvatar() {
  var randomNumber = Math.floor(Math.random() * 2) + 1;
  document.getElementById("avatar").src = `./media/${randomNumber}.jpg`;
}

function newQuote() {
  var randomNumber = Math.floor(Math.random() * (quotes.length));
  var randQuote = quotes[randomNumber];
  document.getElementById('quoteDisplay').innerHTML = randQuote;

  if (randQuote.replace(/<[^>]*>/g, '').length <= 15) {
    document.getElementById("footer-span").style.display = "flex";
    document.getElementById("footer-span").style.justifyContent = "space-between";
  }
}
