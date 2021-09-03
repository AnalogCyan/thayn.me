import { v4 as uuidv4 } from "./uuid/dist/esm-browser/index.js";
window.onload = function load() {
  newMail();
};

function newMail() {
  console.log(uuidv4());
  window.location.replace("mailto:" + uuidv4() + "@mail.thayn.me");
}
