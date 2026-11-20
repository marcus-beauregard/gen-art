const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SKETCH = fs.readFileSync(path.join(__dirname, '..', 'sketch.js'), 'utf8');

// Seeded RNG so two sketches start from the same particle cloud and the only
// difference between them is the frame interval they are stepped at.
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

// Boots sketch.js against a minimal DOM/Three.js double (same shape as
// particles.test.js) and exposes the animation frame callback, the position
// buffer and the mesh rotation.
function makeSketch({ seed = 1, width = 1280, height = 720 } = {}) {
  let frame = null;
  let geometry = null;
  let mesh = null;
  const window = {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: 1,
    addEventListener() {},
  };
  class WebGLRenderer {
    setPixelRatio() {}
    setSize() {}
    render() {}
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
    requestAnimationFrame(fn) { frame = fn; return 0; },
    console,
    Math: seededMath(seed),
    Float32Array,
  });
  vm.runInContext(SKETCH, context, { filename: 'sketch.js' });
  assert.equal(typeof frame, 'function', 'sketch.js must schedule its first frame');
  return {
    positions: geometry.attributes.position.array,
    frame: (timestamp) => frame(timestamp),
    rotationY: () => mesh.rotation.y,
  };
}

test('the first frame starts at elapsed zero, whatever the page clock says', () => {
  const { positions, frame, rotationY } = makeSketch();
  const before = Float32Array.from(positions);

  // A page that had been open for ~16 minutes before the loop started.
  frame(987654.321);

  assert.equal(rotationY(), 0, 'the first frame must not inherit the page-load clock');
  for (let i = 0; i < positions.length; i++) {
    assert.equal(positions[i], before[i], 'the first frame must not step the field: position ' + i);
  }
});

test('the mesh rotation tracks simulated seconds, not frame count', () => {
  const angleAfter = (hz) => {
    const { frame, rotationY } = makeSketch({ seed: 7 });
    frame(0); // the first callback only starts the clock; give it no time
    for (let i = 1; i <= hz * 2; i++) frame((i * 1000) / hz);
    return rotationY();
  };
  const expected = 2 * 0.02; // two seconds at 0.02 rad/s
  const at60 = angleAfter(60);
  const at144 = angleAfter(144);
  assert.ok(Math.abs(at60 - expected) < 1e-9, '60 Hz rotated ' + at60);
  assert.ok(Math.abs(at144 - expected) < 1e-9, '144 Hz rotated ' + at144);
});

test('a stalled frame advances the field by the clamped step, not by the stall', () => {
  const { positions, frame, rotationY } = makeSketch();
  frame(0);
  const before = Float32Array.from(positions);
  frame(5000); // tab was backgrounded for five seconds

  assert.ok(rotationY() <= (1 / 30) * 0.02 + 1e-9, 'a five-second stall rotated ' + rotationY());
  // The same clamp has to bound the integrator: an unclamped five-second step
  // would carry a particle by tens of units, not by a fraction of one. Measured
  // through the wrap, since a particle seeded near the edge crosses the face.
  const BOUND = 30;
  const SPAN = BOUND * 2;
  const throughWrap = (d) => (((d + BOUND) % SPAN) + SPAN) % SPAN - BOUND;
  for (let i = 0; i < positions.length; i++) {
    const hop = throughWrap(positions[i] - before[i]);
    assert.ok(Math.abs(hop) < 1, 'a five-second stall moved position ' + i + ' by ' + hop);
  }
});

test('the field does not depend on how long the page had been open', () => {
  // Same seeded cloud, same frame interval, one sketch booted at page-clock
  // zero and one at ~16 minutes: a raw-timestamp input would diverge, an
  // elapsed-seconds input cannot.
  const runFrom = (clockOffset) => {
    const { positions, frame } = makeSketch({ seed: 11 });
    for (let i = 1; i <= 90; i++) frame(clockOffset + i * (1000 / 60));
    return Float32Array.from(positions);
  };

  const atZero = runFrom(0);
  const late = runFrom(987654);
  for (let i = 0; i < atZero.length; i++) {
    // Large timestamps lose a few float32 bits per subtraction; a raw-clock
    // input would move the field by whole units, not by rounding noise.
    assert.ok(
      Math.abs(late[i] - atZero[i]) < 1e-3,
      'position ' + i + ' depends on the page clock: ' + atZero[i] + ' vs ' + late[i],
    );
  }
});

test('the field travels the same distance per second at 30 Hz and 144 Hz', () => {
  // Distance travelled beats start-to-end displacement: the wrap teleports a
  // particle across the box, which makes an endpoint metric understate motion
  // differently at different step sizes.
  const distancePerSecond = (hz) => {
    const { positions, frame } = makeSketch({ seed: 42 });
    frame(0); // prime the clock so every measured frame advances exactly 1/hz s
    const sampled = [];
    for (let i = 0; i < positions.length; i += 300) sampled.push(i); // 80 particles
    const prev = new Float32Array(sampled.length * 3);
    for (let k = 0; k < sampled.length; k++) {
      for (let axis = 0; axis < 3; axis++) prev[k * 3 + axis] = positions[sampled[k] + axis];
    }

    let total = 0;
    for (let f = 1; f <= hz * 3; f++) {
      frame((f * 1000) / hz);
      for (let k = 0; k < sampled.length; k++) {
        const i = sampled[k];
        const dx = positions[i] - prev[k * 3];
        const dy = positions[i + 1] - prev[k * 3 + 1];
        const dz = positions[i + 2] - prev[k * 3 + 2];
        const step = Math.hypot(dx, dy, dz);
        if (step < 5) total += step; // ignore the wrap jump across the box
        prev[k * 3] = positions[i];
        prev[k * 3 + 1] = positions[i + 1];
        prev[k * 3 + 2] = positions[i + 2];
      }
    }
    return total / sampled.length / 3;
  };

  const slow = distancePerSecond(30);
  const fast = distancePerSecond(144);
  const drift = Math.abs(fast - slow) / slow;
  assert.ok(
    drift < 0.1,
    '3 s of motion drifted by ' + (drift * 100).toFixed(1) + '% between 30 Hz (' + slow + ') and 144 Hz (' + fast + ')',
  );
});
