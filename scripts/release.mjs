// One-command release.
//
//   npm run release              # patch bump (x.y.Z+1)
//   npm run release minor        # x.Y+1.0
//   npm run release major        # X+1.0.0
//   npm run release 1.2.3        # explicit version
//
// Bumps the version in tauri.conf.json, package.json and Cargo.toml (kept in
// lockstep), commits "Release vX.Y.Z", tags it, and pushes the branch + tag.
// Pushing the tag triggers .github/workflows/release.yml, which builds the
// signed installer + updater manifest and PUBLISHES the GitHub release — so
// installed apps auto-update. There is no draft step; a pushed tag ships.
//
// Run from a clean working tree on the branch you release from (usually main).

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const TAURI = "src-tauri/tauri.conf.json";
const PKG = "package.json";
const CARGO = "src-tauri/Cargo.toml";
const VERSION_RE = /("version":\s*")\d+\.\d+\.\d+(")/; // JSON files
const CARGO_RE = /^version\s*=\s*"\d+\.\d+\.\d+"/m; // package version line

function die(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

// Current version is taken from tauri.conf.json — the source of truth the app
// and updater use.
const tauriRaw = readFileSync(TAURI, "utf8");
const m = tauriRaw.match(/"version":\s*"(\d+)\.(\d+)\.(\d+)"/);
if (!m) die(`Couldn't find a version in ${TAURI}.`);
const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
const curr = `${maj}.${min}.${pat}`;

const arg = (process.argv[2] || "patch").trim();
let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) next = arg;
else if (arg === "major") next = `${maj + 1}.0.0`;
else if (arg === "minor") next = `${maj}.${min + 1}.0`;
else if (arg === "patch") next = `${maj}.${min}.${pat + 1}`;
else die(`Unknown argument "${arg}". Use patch | minor | major | x.y.z.`);

if (next === curr) die(`Version is already ${curr}.`);

// Never fold unrelated uncommitted work into a release commit.
const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
if (dirty) die(`Working tree is dirty — commit or stash first:\n${dirty}`);

console.log(`Releasing v${next}  (was v${curr})`);

writeFileSync(TAURI, tauriRaw.replace(VERSION_RE, `$1${next}$2`));
writeFileSync(PKG, readFileSync(PKG, "utf8").replace(VERSION_RE, `$1${next}$2`));
writeFileSync(CARGO, readFileSync(CARGO, "utf8").replace(CARGO_RE, `version = "${next}"`));

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
run(`git add ${TAURI} ${PKG} ${CARGO}`);
run(`git commit -m "Release v${next}"`);
run(`git tag -a "v${next}" -m "v${next}"`);
run("git push origin HEAD");
run(`git push origin "v${next}"`);

console.log(`\n✓ Released v${next}. CI is building + publishing it now.`);
console.log(`  Installed apps auto-update on launch / every 6h / tray "Check for updates".`);
