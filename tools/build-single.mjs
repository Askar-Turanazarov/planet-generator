// Zero-dependency bundler: folds index.html + css + every local ES module into
// one page. Three.js comes from vendor/ (see tools/vendor-three.mjs).
// Usage: node tools/build-single.mjs
//
// Output, all in dist/ (the folder a static host such as Vercel serves):
//   index.html             the site's entry page; it loads Three.js from
//                          vendor/ through the import map, as separate files a
//                          browser keeps in its cache from one release to the next
//   planet-generator.html  the same page with Three.js inside it as well: one
//                          file that runs on its own, opened straight from the
//                          disk, with no network at all
//   vendor/                Three.js for index.html
//   manifest.webmanifest, icons/   what "Add to Home Screen" needs
//
// It is deliberately simple: local modules are concatenated in dependency
// order inside a single <script type="module">. That works because the source
// follows two rules, which the build verifies: named exports only, and no two
// modules declare the same top-level name.
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENTRY_HTML = join(ROOT, 'index.html');
const DIST = join(ROOT, 'dist');
const SITE_PAGE = 'index.html';
const STANDALONE_PAGE = 'planet-generator.html';
const STATIC = ['manifest.webmanifest', 'icons', 'vendor'];

const IMPORT = /^import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"];?[ \t]*\r?\n/gm;
const DECLARATION = /^(?:export\s+)?(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm;

const rel = (file) => relative(ROOT, file).replace(/\\/g, '/');

/** Depth-first walk of the module graph; dependencies land before dependants. */
async function collect(file, seen, order, externals) {
  if (seen.has(file)) return;
  seen.add(file);
  const source = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
  const body = [];
  let cursor = 0;
  for (const match of source.matchAll(IMPORT)) {
    const [statement, specifier] = match;
    body.push(source.slice(cursor, match.index));
    cursor = match.index + statement.length;
    if (specifier.startsWith('.')) {
      await collect(resolve(dirname(file), specifier), seen, order, externals);
    } else {
      externals.add(statement.trim().replace(/\s+/g, ' '));
    }
  }
  body.push(source.slice(cursor));
  order.push({ file, code: body.join('') });
}

function checkUniqueNames(modules) {
  const owner = new Map();
  for (const { file, code } of modules) {
    for (const [, name] of code.matchAll(DECLARATION)) {
      if (owner.has(name) && owner.get(name) !== file) {
        throw new Error(`Top-level name "${name}" is declared in both ${rel(owner.get(name))} and ${rel(file)}`);
      }
      owner.set(name, file);
    }
  }
}

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path)));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out.sort();
}

/**
 * The standalone page: every module the import map names travels inside the
 * page as text. A small script turns each into a blob: URL and installs an
 * import map of those before the application module is parsed, so the
 * application code stays exactly as in the site page.
 */
async function selfContained(html) {
  const mapTag = /<script type="importmap">\s*([\s\S]*?)\s*<\/script>/;
  const found = html.match(mapTag);
  if (!found) throw new Error('index.html: import map not found');
  const { imports } = JSON.parse(found[1]);

  // Module specifier -> source file. A key ending in "/" maps a folder.
  const modules = [];
  for (const [key, path] of Object.entries(imports)) {
    if (/^[a-z]+:/i.test(path)) throw new Error(`Import map entry "${key}" is not a local file: ${path}`);
    const file = join(ROOT, path);
    if (!key.endsWith('/')) modules.push({ key, file });
    else for (const inner of await listFiles(file)) modules.push({ key: key + relative(file, inner).replace(/\\/g, '/'), file: inner });
  }

  const blocks = [];
  for (const { key, file } of modules) {
    // A blob: module has no folder of its own: relative imports become the
    // full specifiers they stand for, which the generated import map lists.
    const code = (await readFile(file, 'utf8'))
      .replace(/\r\n/g, '\n')
      .replace(/((?:from|import)\s*['"])(\.{1,2}\/[^'"]+)(['"])/g,
        (_, open, specifier, close) => open + posix.normalize(posix.join(posix.dirname(key), specifier)) + close);
    if (/<\/script|<!--/i.test(code)) throw new Error(`${rel(file)} contains "</script" or "<!--", which cannot be inlined`);
    blocks.push(`<script type="text/plain" data-module="${key}">${code}</script>`);
  }
  const loader = `<script>
  // Turns the modules above into blob: URLs and maps their specifiers to them.
  (() => {
    const imports = {};
    for (const node of document.querySelectorAll('script[type="text/plain"][data-module]')) {
      imports[node.dataset.module] = URL.createObjectURL(new Blob([node.textContent], { type: 'text/javascript' }));
    }
    const map = document.createElement('script');
    map.type = 'importmap';
    map.textContent = JSON.stringify({ imports });
    document.currentScript.after(map);
  })();
  </script>`;

  return html
    .replace(/[ \t]*<link rel="modulepreload"[^>]*>\n?/g, '')
    .replace(mapTag, () => `${blocks.join('\n  ')}\n  ${loader}`);
}

async function build() {
  let html = (await readFile(ENTRY_HTML, 'utf8')).replace(/\r\n/g, '\n');

  // ---- scripts ----
  const scriptTag = /<script type="module" src="([^"]+)"><\/script>/;
  const entry = html.match(scriptTag);
  if (!entry) throw new Error('index.html: module entry point not found');

  const modules = [];
  const externals = new Set();
  await collect(join(ROOT, entry[1]), new Set(), modules, externals);
  checkUniqueNames(modules);

  const script = [
    [...externals].join('\n'),
    ...modules.map(({ file, code }) => {
      if (/^export\s+default\b/m.test(code)) throw new Error(`${rel(file)}: default exports are not supported`);
      const stripped = code.replace(/^export\s+(?=(?:async\s+)?(?:const|let|var|function|class)\b)/gm, '').trim();
      if (/^export\b/m.test(stripped)) throw new Error(`${rel(file)}: unsupported export form`);
      return `// ===== ${rel(file)} =====\n${stripped}`;
    }),
  ].join('\n\n');
  if (/<\/script/i.test(script)) throw new Error('A module contains "</script", which cannot be inlined');

  // ---- styles ----
  const styleTag = /<link rel="stylesheet" href="([^"]+)">/;
  const sheet = html.match(styleTag);
  if (!sheet) throw new Error('index.html: stylesheet link not found');
  const css = (await readFile(join(ROOT, sheet[1]), 'utf8')).replace(/\r\n/g, '\n').trim();

  // (Function replacers: the payloads are full of "$" sequences.)
  html = html
    .replace(styleTag, () => `<style>\n${css}\n  </style>`)
    .replace(scriptTag, () => `<script type="module">\n${script}\n  </script>`);

  // Start from an empty folder, so nothing stale is ever published.
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  const pages = [[SITE_PAGE, html], [STANDALONE_PAGE, await selfContained(html)]];
  for (const [page, content] of pages) {
    await writeFile(join(DIST, page), content);
    console.log(`dist/${page}  ${(Buffer.byteLength(content) / 1024).toFixed(1)} kB`);
  }
  for (const name of STATIC) {
    await cp(join(ROOT, name), join(DIST, name), { recursive: true });
    console.log(`dist/${name}`);
  }
  console.log(`${modules.length} modules:`);
  for (const { file } of modules) console.log(`  + ${rel(file)}`);
}

build().catch((error) => {
  console.error(`Build failed: ${error.message}`);
  process.exit(1);
});
