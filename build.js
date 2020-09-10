const chokidar = require("chokidar");
const process = require("process");
const { spawn } = require("child_process");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

function getFiles(atPath) {
  let current = null;
  let paths = [atPath];

  async function next() {
    let statPath = paths.shift();
    if (!statPath) {
      current = null;
      return false;
    }

    let stat = await fsp.stat(statPath);
    if (stat.isFile()) {
      current = statPath;
      return true;
    } else if (stat.isDirectory()) {
      const subpaths = (await fsp.readdir(statPath)).map((p) =>
        path.join(statPath, p)
      );
      Array.prototype.push.apply(paths, subpaths);
      return next();
    }

    throw `Not a directory or a file: ${statPath}`;
  }

  return { current: () => current, next: next };
}

async function copyToPublish() {
  const cid = process.env.CLIENT_ID;
  if (!cid) {
    throw "Could not find CLIENT_ID environment variable";
  }

  const efile = await fsp.open("./publish/environment.js", "w+");
  await efile.writeFile(`window.CLIENT_ID = "${cid}";`);

  await fsp.copyFile(
    "./node_modules/dexie/dist/dexie.js",
    "./publish/dexie.js"
  );

  await fsp.copyFile(
    "./node_modules/webextension-polyfill/dist/browser-polyfill.js",
    "./publish/browser-polyfill.js"
  );

  await fsp.copyFile("./empty_table.xlsx", "./publish/empty_table.xlsx");
  await fsp.copyFile("./popup.html", "./publish/popup.html");
  await fsp.copyFile("./manifest.json", "./publish/manifest.json");
}

// Copy */types/webextension.d.ts files to @types/*/webextension.d.ts to satisfy TypeScript
async function fixTscTypes() {
  const files = getFiles("./node_modules");
  while (await files.next()) {
    const file = files.current();
    const dtsMatch = file.match(
      /node_modules[\\/](.*)[\\/]types[\\/]index\.d\.ts$/
    );
    if (dtsMatch && dtsMatch.length > 0) {
      const package = dtsMatch[1];
      if (package === "chokidar") continue;
      const packagePath = `./node_modules/@types/${package}`;
      console.log(`Adding ${packagePath}`);
      try {
        await fsp.stat(packagePath);
      } catch {
        await fsp.mkdir(packagePath);
      }

      await fsp.copyFile(file, path.join(packagePath, "index.d.ts"));
    }
  }
}

async function runTsc() {
  const tsc = spawn("tsc", [], { shell: true, stdio: "inherit" });
  return new Promise((resolve) => {
    tsc.on("close", (code) => resolve(code));
  });
}

async function build() {
  process.stdout.write(`${new Date().toISOString()} Building.. \n`);
  await copyToPublish();
  await fixTscTypes();
  let code = await runTsc();
  if (code === 0) process.stdout.write(`${new Date().toISOString()} Done.`);
}

function watch() {
  const tsc = spawn("tsc", ["-w"], { shell: true, stdio: "inherit" });
  let changes = [];
  chokidar
    .watch(".", {
      depth: 0,
      awaitWriteFinish: true,
      ignored: /(.*).js$|(.*).ts$/,
    })
    .on("change", async (event, path) => {
      changes.push(new Date().toISOString());
      if (changes.length > 1) return;

      let last = changes.pop();
      while (last) {
        process.stdout.write(
          `${new Date().toISOString()} Copying file changes for ${event}.\n`
        );
        await copyToPublish();
        process.stdout.write("Done.");
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
