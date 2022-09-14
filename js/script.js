// Hey look, this is what's in the thayn.me JavaScript file!
// If you got here from the site footer, you can find a list of all the quotes that can show up there
// at https://thayn.me/media/quotes.txt

window.onload = function load() {
  copyDate();
  newQuote();
  deadPixel();

  setInterval(() => {
    subHead();
  }, 5000);
};

const sub = [
  "test1",
  "test2",
  "test3",
  "test4",
  "test5",
  "test6",
  "test7",
  "test8",
];

function subHead() {
  var elem = document.getElementById("subhead");

  elem.classList.toggle("fade");
  elem.innerText = sub[Math.floor(Math.random() * sub.length)];
  elem.classList.toggle("fade");
}

function loadFile(filePath) {
  var result = null;
  var xmlhttp = new XMLHttpRequest();
  xmlhttp.open("GET", filePath, false);
  xmlhttp.send();
  if (xmlhttp.status === 200) {
    result = xmlhttp.responseText;
  }
  return result;
}

function randPhoto() {
  let num = Math.floor(Math.random() * 3) + 1;
  document.getElementById("profile").src = `./media/profile${num}.jpg`;
}

function copyDate() {
  document.getElementById("cDate").innerHTML = new Date().getFullYear();
}

function newQuote() {
  var quotes = loadFile("./media/quotes.txt").split("\n");
  var randomNumber = Math.floor(Math.random() * quotes.length);
  var randQuote = quotes[randomNumber];
  document.getElementById("quoteDisplay").innerHTML = randQuote;

  if (randQuote.replace(/<[^>]*>/g, "").length <= 15) {
    document.getElementById("footer-span").style.display = "flex";
    document.getElementById("footer-span").style.justifyContent =
      "space-between";
  }
}

// ...but I went and made it more evil!
function deadPixel() {
  var randomTop = Math.floor(Math.random() * window.innerHeight);
  var randomLeft = Math.floor(Math.random() * window.innerWidth);
  document.getElementById("broken-green-pixel").style.top = randomTop + "px";
  document.getElementById("broken-green-pixel").style.left = randomLeft + "px";
}
