// Runs the syndication script after a successful deploy

const { spawn } = require("node:child_process");
const path = require("node:path");

function runSyndicationScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`Post-deploy syndication script exited with code ${code}`)
      );
    });
  });
}

module.exports = {
  // The deploy already succeeded by this point; a syndication failure must not
  // fail the build. It retries on the next deploy.
  onSuccess: async () => {
    const scriptPath = path.resolve(
      process.cwd(),
      "netlify/post-deploy/run-syndication.js"
    );
    try {
      await runSyndicationScript(scriptPath);
    } catch (error) {
      console.log(`post-deploy-syndication: failed, skipping: ${error}`);
    }
  },
};
