const chokidar = require("chokidar");
const process = require("process");
const { spawn } = require("child_process");
const fs = require("fs");

async function build() {
  process.stdout.write(`${new Date().toISOString()} Building.. \n`);

  const tsc = spawn("tsc", [], { shell: true, stdio: "inherit" });
  const b = new Promise((resolve) => {
    tsc.on("close", (code) => resolve(code));
  });

  const code = await b;
  function onErr(err) {
    if (err) throw err;
  }

  fs.copyFile(
    "./node_modules/dropbox/dist/Dropbox-sdk.min.js",
    "./publish/Dropbox-sdk.js",
    onErr
  );

  fs.copyFile(
    "./node_modules/dexie/dist/dexie.js",
    "./publish/dexie.js",
    onErr
  );

  fs.copyFile(
    "./node_modules/xlsx/dist/xlsx.full.min.js",
    "./publish/xlsx.full.min.js",
    onErr
  );

  fs.copyFile("./popup.html", "./publish/popup.html", onErr);
  fs.copyFile("./manifest.json", "./publish/manifest.json", onErr);

  if (code === 0) process.stdout.write("Finished.");
}

function watch() {
  let changes = [];
  chokidar
    .watch(".", { depth: 0, awaitWriteFinish: true })
    .on("change", async (event, path) => {
      changes.push(new Date().toISOString());
      if (changes.length > 1) return;

      let last = changes.pop();
      while (last) {
        await build();
        const latest = changes.pop();
        if (latest && latest > last) last = latest;
        else break;
      }
    });
}

async function main(args) {
  if (args.length === 0) {
    await build();
  } else {
    if (args[0] === "build") {
      await build();
    } else if (args[0] === "watch") {
      watch();
    } else {
      console.warn(`Unrecognized command line argument: ${args[0]}`);
    }
  }
}

main(process.argv.slice(2));
