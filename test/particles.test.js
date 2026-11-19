const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SKETCH = fs.readFileSync(path.join(__dirname, '..', 'sketch.js'), 'utf8');

// Boots sketch.js against a minimal DOM/Three.js double and hands back the
// animation frame callback plus the live position buffer, so the particle
// integrator can be stepped without a browser or a WebGL context.
function makeSketch(width = 1280, height = 720) {
  let frame = null;
  let geometry = null;
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
    setAttribute(name, attribute) { this.attributes[name] = attribute; if (name === 'position') geometry = this; }
  }
  class Scene { add() {} }
  class Points { constructor() { this.rotation = { x: 0, y: 0, z: 0 }; } }
  class PointsMaterial {}

  const context = vm.createContext({
    window,
    document: { getElementById: () => ({}) },
    THREE: {
      WebGLRenderer,
      PerspectiveCamera,
      BufferAttribute,
      BufferGeometry,
      Scene,
      Points,
      PointsMaterial,
    },
    requestAnimationFrame(fn) { frame = fn; return 0; },
    console,
    Math,
    Float32Array,
  });
  vm.runInContext(SKETCH, context, { filename: 'sketch.js' });
  assert.equal(typeof frame, 'function', 'sketch.js must schedule its first frame');
  return {
    positions: geometry.attributes.position.array,
    frame: (timestamp) => frame(timestamp),
  };
}

test('particles stay inside the seeding box instead of drifting out of view', () => {
  const { positions, frame } = makeSketch();
  const BOUND = 30;
  const EPS = 1e-6;

  // ~25 seconds at 60 Hz is long enough for an unbounded random walk to carry
  // the fastest particles well past the camera frustum.
  for (let i = 1; i <= 900; i++) frame(i * (1000 / 60));

  for (let i = 0; i < positions.length; i++) {
    const v = positions[i];
    assert.ok(Number.isFinite(v), 'position ' + i + ' is not finite: ' + v);
    assert.ok(Math.abs(v) <= BOUND + EPS, 'position ' + i + ' escaped the box: ' + v);
  }
});

test('the field is still moving after the wrap is applied', () => {
  const { positions, frame } = makeSketch();
  const before = Float32Array.from(positions);
  for (let i = 1; i <= 120; i++) frame(i * (1000 / 60));
  const moved = positions.some((v, i) => Math.abs(v - before[i]) > 1e-9);
  assert.ok(moved, 'particles did not move');
});
