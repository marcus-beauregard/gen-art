const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SKETCH = fs.readFileSync(path.join(__dirname, '..', 'sketch.js'), 'utf8');

// Same seeded RNG as framerate.test.js, so two sketches boot the same cloud
// and their position buffers can be compared directly.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededMath(seed) {
  const m = {};
  for (const key of Object.getOwnPropertyNames(Math)) m[key] = Math[key];
  m.random = mulberry32(seed);
  return m;
}

// Boots sketch.js against a DOM/Three.js double whose matchMedia reports the
// prefers-reduced-motion preference, and records every animation frame the
// sketch schedules plus every render it issues, so "is the loop running" and
// "did anything reach the screen" can be asserted without a browser.
function makeSketch({ reduce = false, mediaQuery = true, seed = 1 } = {}) {
  const frames = [];
  let renders = 0;
  let mesh = null;
  let geometry = null;
  const listeners = new Map();
  const mql = {
    matches: reduce,
    listeners: [],
    addEventListener(type, fn) {
      if (type === 'change') this.listeners.push(fn);
    },
    set(matches) {
      this.matches = matches;
      for (const fn of this.listeners) fn({ matches });
    },
  };
  const window = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener(type, fn) { listeners.set(type, fn); },
  };
  if (mediaQuery) {
    window.matchMedia = (query) => {
      assert.equal(query, '(prefers-reduced-motion: reduce)', 'the sketch must ask for the reduced-motion query');
      return mql;
    };
  }
  class WebGLRenderer {
    setPixelRatio() {}
    setSize() {}
    render() { renders += 1; }
  }
  class PerspectiveCamera {
    constructor(fov, aspect) {
      this.fov = fov;
      this.aspect = aspect;
      this.position = { z: 0 };
      this.updateProjectionMatrix = () => {};
    }
  }
  class BufferAttribute {
    constructor(array) { this.array = array; this.needsUpdate = false; }
  }
  class BufferGeometry {
    constructor() { this.attributes = {}; }
    setAttribute(name, attribute) {
      this.attributes[name] = attribute;
      if (name === 'position') geometry = this;
    }
  }
  class Scene { add() {} }
  class Points { constructor() { this.rotation = { x: 0, y: 0, z: 0 }; mesh = this; } }
  class PointsMaterial {}

  const context = vm.createContext({
    window,
    document: { getElementById: () => ({}) },
    THREE: { WebGLRenderer, PerspectiveCamera, BufferAttribute, BufferGeometry, Scene, Points, PointsMaterial },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    console,
    Math: seededMath(seed),
    Float32Array,
  });
  vm.runInContext(SKETCH, context, { filename: 'sketch.js' });

  return {
    frames,
    renderCount: () => renders,
    positions: geometry.attributes.position.array,
    listeners,
    window,
    mql,
    rotationY: () => mesh.rotation.y,
    lastFrame: () => frames[frames.length - 1],
  };
}

test('reduced motion draws one static frame and schedules no loop', () => {
  const sketch = makeSketch({ reduce: true });
  assert.equal(sketch.renderCount(), 1, 'the page must still show something');
  assert.equal(sketch.frames.length, 0, 'no frame callback may be queued');
  assert.equal(sketch.rotationY(), 0, 'the static frame is the untouched seed cloud');
});

test('toggling the preference starts and stops the loop without a reload', () => {
  const sketch = makeSketch({ reduce: true });
  assert.equal(sketch.frames.length, 0);

  sketch.mql.set(false);
  assert.equal(sketch.frames.length, 1, 'turning the preference off must start the loop');

  const first = sketch.lastFrame();
  first(0);
  assert.equal(sketch.renderCount(), 2);
  assert.equal(sketch.frames.length, 2, 'a running loop keeps re-arming');

  sketch.lastFrame()(16.7);
  assert.equal(sketch.renderCount(), 3);

  const queuedBeforePause = sketch.frames.length;
  sketch.mql.set(true);
  sketch.lastFrame()(33.4);
  assert.equal(sketch.renderCount(), 3, 'a frame queued before the pause must not draw');
  assert.equal(sketch.frames.length, queuedBeforePause, 'a paused loop must not schedule another frame');
});

test('resuming after a pause does not step the field by the paused time', () => {
  const sketch = makeSketch({ reduce: false });
  sketch.lastFrame()(0); // the first callback only primes the clock
  sketch.lastFrame()(1000); // a one-second gap, clamped to a single 1/30 s step
  const beforePause = sketch.rotationY();
  assert.ok(Math.abs(beforePause - (0.02 / 30)) < 1e-9, 'one clamped step rotated ' + beforePause);

  sketch.mql.set(true);
  const pausedAt = sketch.renderCount();
  sketch.lastFrame()(2000); // the frame queued before the pause runs and is dropped
  assert.equal(sketch.renderCount(), pausedAt);
  const beforeResume = sketch.rotationY();
  assert.equal(beforeResume, beforePause, 'a stale frame must not step the field');

  // A minute passes with the page standing still, then the preference flips
  // back. The resume frame's timestamp is far ahead of the last one, so an
  // unreset clock would advance the field by the clamped 1/30 s hop; the
  // resume has to start from zero instead.
  sketch.mql.set(false);
  const resumedLength = sketch.frames.length;
  sketch.lastFrame()(62000);
  assert.equal(sketch.frames.length, resumedLength + 1, 'the loop must re-arm after resuming');
  assert.ok(
    Math.abs(sketch.rotationY() - beforeResume) < 1e-9,
    'the resume frame inherited the pause: ' + sketch.rotationY(),
  );
});

test('the static frame is the untouched seed cloud', () => {
  const still = makeSketch({ reduce: true, seed: 99 });
  const running = makeSketch({ reduce: false, seed: 99 }); // never ticked
  assert.deepEqual(Array.from(still.positions), Array.from(running.positions));
});

test('a resize while reduced motion is active repaints the static frame', () => {
  const sketch = makeSketch({ reduce: true });
  assert.equal(sketch.renderCount(), 1);

  sketch.window.innerWidth = 600;
  sketch.window.innerHeight = 900;
  sketch.listeners.get('resize')();

  assert.equal(sketch.renderCount(), 2, 'the resized canvas must be redrawn');
  assert.equal(sketch.frames.length, 0, 'a resize must not start the loop');
});

test('a preference flipped twice before the queued frame runs leaves one loop', () => {
  const sketch = makeSketch({ reduce: false });
  assert.equal(sketch.frames.length, 1);

  // Reduce and back before the pending callback has had a chance to run: the
  // first callback is now stale, and a naive resume would queue a second chain
  // of frames alongside it.
  sketch.mql.set(true);
  sketch.mql.set(false);
  assert.equal(sketch.frames.length, 2, 'the resume queues exactly one frame');

  const stale = sketch.frames[0];
  const fresh = sketch.frames[1];
  const before = sketch.renderCount();
  stale(16.7);
  assert.equal(sketch.renderCount(), before, 'the stale callback must not draw');
  assert.equal(sketch.frames.length, 2, 'the stale callback must not queue a successor');

  fresh(33.4);
  assert.equal(sketch.frames.length, 3, 'the live loop re-arms exactly once');
  sketch.frames[2](50);
  assert.equal(sketch.frames.length, 4, 'one frame in, one frame queued');
});

test('a window without matchMedia still animates', () => {
  const sketch = makeSketch({ mediaQuery: false });
  assert.equal(sketch.frames.length, 1, 'the loop must run when the preference cannot be read');
  assert.equal(sketch.renderCount(), 0, 'the static frame is only for the reduced case');
  assert.equal(typeof sketch.lastFrame(), 'function');
});
