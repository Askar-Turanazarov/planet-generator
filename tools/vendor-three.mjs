// Copies Three.js into the project (vendor/), so the site never depends on a
// CDN: it runs offline, from the local network, or from a static host alone.
// Usage: node tools/vendor-three.mjs [version]      (npm run vendor)
//
// What it does:
//   1. "npm pack three@<version>" downloads the official package from the npm
//      registry; npm checks it against the registry's integrity hash.
//   2. From that archive it takes only what the project imports: the minified
//      core and the add-ons named in src/ (plus the add-ons those import).
//   3. It writes them to vendor/three-<version>/, removes any other version,
//      and points the import map in index.html at the new folder.
// The version is part of the folder name, so a host can cache the files
// forever: a new version is a new address.
import { execSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const VENDOR = join(ROOT, 'vendor');
const INDEX = join(ROOT, 'index.html');
const DEFAULT_VERSION = '0.170.0';

const ADDON_IMPORT = /from\s+['"]three\/addons\/([^'"]+)['"]/g;
const RELATIVE_IMPORT = /(?:from|import)\s+['"](\.{1,2}\/[^'"]+)['"]/g;

/** Every file of a .tar archive, by name. */
function untar(buffer) {
  const files = new Map();
  let offset = 0;
  let longName = null;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    const prefix = field(345, 155);
    let name = longName || (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    const body = buffer.subarray(offset + 512, offset + 512 + size);
    if (type === 'L') longName = body.toString('utf8').replace(/\0.*$/s, '');
    else if (type === '0' || type === '') files.set(name, body);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function sourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

async function main() {
  const version = process.argv[2] || DEFAULT_VERSION;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Not a version number: ${version}`);

  // ---- 1. download the package ----
  const work = await mkdtemp(join(tmpdir(), 'three-pack-'));
  try {
    // One command line (npm is a .cmd script on Windows, which needs a shell);
    // the version was checked above and the folder name comes from mkdtemp.
    const output = execSync(`npm pack three@${version} --json --pack-destination "${work}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const [packed] = JSON.parse(output);
    const files = untar(gunzipSync(await readFile(join(work, packed.filename))));
    const take = (name) => {
      const body = files.get(`package/${name}`);
      if (!body) throw new Error(`three@${version} has no ${name}`);
      return body;
    };

    // ---- 2. what the project imports ----
    const wanted = new Set();
    for (const file of await sourceFiles(join(ROOT, 'src'))) {
      for (const [, addon] of (await readFile(file, 'utf8')).matchAll(ADDON_IMPORT)) wanted.add(addon);
    }
    const addons = new Map();
    const visit = (addon) => {
      if (addons.has(addon)) return;
      const body = take(`examples/jsm/${addon}`);
      addons.set(addon, body);
      for (const [, specifier] of body.toString('utf8').matchAll(RELATIVE_IMPORT)) {
        visit(posix.normalize(posix.join(posix.dirname(addon), specifier)));
      }
    };
    [...wanted].sort().forEach(visit);

    // ---- 3. write vendor/three-<version>/ ----
    const folder = `three-${version}`;
    const target = join(VENDOR, folder);
    await mkdir(VENDOR, { recursive: true });
    for (const entry of await readdir(VENDOR)) {
      if (entry.startsWith('three-')) await rm(join(VENDOR, entry), { recursive: true, force: true });
    }
    const write = async (name, body) => {
      await mkdir(dirname(join(target, name)), { recursive: true });
      await writeFile(join(target, name), body);
    };
    await write('three.module.min.js', take('build/three.module.min.js'));
    for (const [addon, body] of addons) await write(`addons/${addon}`, body);
    await write('LICENSE', take('LICENSE'));
    await write('SOURCE.md', [
      `# Three.js ${version}`,
      '',
      'Copied by `tools/vendor-three.mjs` from the official npm package; do not edit by hand.',
      '',
      `- package: \`three@${version}\` (${packed.filename})`,
      `- integrity: \`${packed.integrity}\``,
      `- licence: MIT, see LICENSE`,
      '',
      'Files:',
      '',
      '- `three.module.min.js` (build/three.module.min.js)',
      ...[...addons.keys()].sort().map((addon) => `- \`addons/${addon}\` (examples/jsm/${addon})`),
      '',
    ].join('\n'));

    // ---- 4. point the import map at it ----
    const html = await readFile(INDEX, 'utf8');
    const updated = html.replace(/vendor\/three-[0-9.]+\//g, `vendor/${folder}/`);
    if (!updated.includes(`vendor/${folder}/`)) throw new Error('index.html: no vendor/three-<version>/ path to update');
    if (updated !== html) await writeFile(INDEX, updated);

    console.log(`vendor/${folder}/  (${packed.integrity})`);
    console.log('  three.module.min.js');
    for (const addon of [...addons.keys()].sort()) console.log(`  addons/${addon}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Vendoring failed: ${error.message}`);
  process.exit(1);
});
