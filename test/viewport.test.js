const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Reads the <meta> tags as attribute maps, so the assertion is about the
// viewport declaration itself rather than attribute order or quote style.
function metas(html) {
  return (html.match(/<meta\b[^>]*>/gi) ?? []).map((tag) => {
    const attrs = {};
    for (const m of tag.matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
    }
    return attrs;
  });
}

// Splits on the first '=' only, and rejects a malformed declaration outright:
// 'width=device-width=x' is not a valid device-width directive, and a parser
// that silently keeps the first two pieces would accept it.
function viewportDirectives(html) {
  const viewport = metas(html).find((m) => m.name && m.name.toLowerCase() === 'viewport');
  if (!viewport) return null;
  const directives = {};
  for (const part of (viewport.content ?? '').split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0 || eq === trimmed.length - 1) return null;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    if (!key || !value || value.includes('=')) return null;
    directives[key] = value;
  }
  return directives;
}

// The parser above is what the assertion rests on, so prove it refuses the
// inputs a browser would also refuse to read as a device-width declaration.
test('viewport parser rejects malformed directives', () => {
  const withViewport = (content) => `<meta name="viewport" content="${content}">`;
  assert.equal(viewportDirectives(withViewport('width=device-width=x')), null);
  assert.equal(viewportDirectives(withViewport('=device-width')), null);
  assert.equal(viewportDirectives(withViewport('width=')), null);
  assert.equal(viewportDirectives(withViewport('width')), null);
  assert.deepEqual(viewportDirectives(withViewport('Width = Device-Width , initial-scale=1')), {
    width: 'Device-Width',
    'initial-scale': '1',
  });
});

// Without this tag a phone lays the page out against the 980px fallback
// viewport, so sketch.js sizes the canvas to 980px and the browser scales the
// whole thing down: a blurry, over-dense buffer instead of a device-width one.
test('index.html declares a device-width viewport', () => {
  const directives = viewportDirectives(HTML);
  assert.ok(directives, 'index.html has no <meta name="viewport">');
  assert.equal(directives.width, 'device-width');
  assert.equal(directives['initial-scale'], '1');
});
