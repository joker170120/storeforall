const fs = require("fs");
const path = require("path");

function dir() {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, "..", "data");
}

function file() {
  return path.join(dir(), "store.json");
}

let chain = Promise.resolve();

function read() {
  const target = file();
  if (!fs.existsSync(target)) return null;
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function write(store) {
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, target);
}

/** Une écriture à la fois. Le mutateur modifie l'objet en place. */
function update(mutator) {
  const run = chain.then(async () => {
    const store = read();
    if (!store) {
      const err = new Error("Magasin absent");
      err.status = 500;
      throw err;
    }
    const result = await mutator(store);
    write(store);
    return result;
  });
  chain = run.then(
    () => {},
    () => {}
  );
  return run;
}

module.exports = { dir, file, read, write, update };
