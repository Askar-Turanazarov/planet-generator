// Zero-dependency bundler: folds index.html + css + every local ES module into
// one self-contained file, dist/planet-generator.html. Three.js keeps coming
// from the CDN through the import map, exactly as in the multi-file version.
// Usage: node tools/build-single.mjs
//
// It is deliberately simple: local modules are concatenated in dependency
// order inside a single <script type="module">. That works because the source
// follows two rules, which the build verifies: named exports only, and no two
// modules declare the same top-level name.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENTRY_HTML = join(ROOT, 'index.html');
const OUTPUT = join(ROOT, 'dist', 'planet-generator.html');

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

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, html);
  console.log(`${rel(OUTPUT)}  ${(Buffer.byteLength(html) / 1024).toFixed(1)} kB  (${modules.length} modules)`);
  for (const { file } of modules) console.log(`  + ${rel(file)}`);
}

build().catch((error) => {
  console.error(`Build failed: ${error.message}`);
  process.exit(1);
});
