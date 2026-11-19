const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SKETCH = fs.readFileSync(path.join(__dirname, '..', 'sketch.js'), 'utf8');

// Runs sketch.js against a minimal DOM/Three.js double so the viewport wiring
// can be asserted without a browser.
function makeSketch(width, height) {
  const calls = { setSize: [], pixelRatio: [], projection: 0 };
  const listeners = new Map();
  const created = {};
  const window = {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: 2,
    addEventListener(type, fn) { listeners.set(type, fn); },
  };
  class WebGLRenderer {
    setPixelRatio(ratio) { calls.pixelRatio.push(ratio); }
    setSize(w, h) { calls.setSize.push([w, h]); }
    render() {}
  }
  class PerspectiveCamera {
    constructor(fov, aspect) {
      this.fov = fov;
      this.aspect = aspect;
      this.position = { z: 0 };
      this.updateProjectionMatrix = () => { calls.projection += 1; };
      created.camera = this;
    }
  }
  class BufferAttribute {
    constructor(array) { this.array = array; this.needsUpdate = false; }
  }
  class BufferGeometry {
    constructor() { this.attributes = {}; }
    setAttribute(name, attribute) { this.attributes[name] = attribute; }
  }
  class Scene { add() {} }
  class Points { constructor() { this.rotation = { x: 0, y: 0, z: 0 }; } }
  class PointsMaterial {}

  const THREE = {
    WebGLRenderer,
    PerspectiveCamera,
    BufferAttribute,
    BufferGeometry,
    Scene,
    Points,
    PointsMaterial,
  };
  const context = vm.createContext({
    window,
    document: { getElementById: () => ({}) },
    THREE,
    requestAnimationFrame: () => 0,
    console,
    Math,
    Float32Array,
  });
  vm.runInContext(SKETCH, context, { filename: 'sketch.js' });
  return { calls, listeners, window, created };
}

test('boot sizes the canvas and camera from the viewport', () => {
  const { calls, created } = makeSketch(1440, 900);
  assert.deepEqual(calls.setSize, [[1440, 900]]);
  assert.equal(created.camera.aspect, 1440 / 900);
  assert.equal(calls.projection, 1);
  assert.deepEqual(calls.pixelRatio, [2]);
});

test('a resize from a different-DPI monitor refreshes the pixel ratio', () => {
  const { calls, listeners, window } = makeSketch(1440, 900);
  window.devicePixelRatio = 1.5;
  listeners.get('resize')();
  assert.equal(calls.pixelRatio.at(-1), 1.5);

  // The ratio stays capped at 2 on a device that reports more.
  window.devicePixelRatio = 3;
  listeners.get('resize')();
  assert.equal(calls.pixelRatio.at(-1), 2);
});

test('resize updates the camera aspect and the renderer size', () => {
  const { calls, listeners, window, created } = makeSketch(1440, 900);
  assert.equal(typeof listeners.get('resize'), 'function');
  window.innerWidth = 800;
  window.innerHeight = 600;
  listeners.get('resize')();
  assert.equal(created.camera.aspect, 800 / 600);
  assert.equal(calls.projection, 2);
  assert.deepEqual(calls.setSize.at(-1), [800, 600]);
});

test('degenerate viewports fall back to a one-pixel dimension', () => {
  const { calls, listeners, window, created } = makeSketch(1000, 500);

  window.innerWidth = 1000;
  window.innerHeight = 0;
  listeners.get('resize')();
  assert.equal(created.camera.aspect, 1000);
  assert.deepEqual(calls.setSize.at(-1), [1000, 1]);
  assert.equal(calls.projection, 2);

  window.innerWidth = 0;
  window.innerHeight = 500;
  listeners.get('resize')();
  assert.equal(created.camera.aspect, 1 / 500);
  assert.deepEqual(calls.setSize.at(-1), [1, 500]);
  assert.equal(calls.projection, 3);
});
