const cron = require("node-cron");
const { exec } = require("child_process");

function run() {
  exec("node sync_leaderboard.js", (err, stdout, stderr) => {
    if (err) console.error("[SYNC ERR]", err.message);
    if (stderr) console.error(stderr.trim());
    if (stdout) console.log(stdout.trim());
  });
}

console.log("SYNC daemon started (every 1 minute)...");
run();
cron.schedule("*/1 * * * *", run);
