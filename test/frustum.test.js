const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SKETCH = fs.readFileSync(path.join(__dirname, '..', 'sketch.js'), 'utf8');

// Boots sketch.js against a minimal DOM/Three.js double and hands back the
// seeded position buffer plus the camera the sketch built.
function makeSketch({ width = 1280, height = 720 } = {}) {
  let geometry = null;
  let camera = null;
  let frame = null;
  const listeners = new Map();
  const window = {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: 1,
    addEventListener(type, fn) { listeners.set(type, fn); },
  };
  class WebGLRenderer {
    setPixelRatio() {}
    setSize() {}
    render() {}
  }
  class PerspectiveCamera {
    constructor(fov, aspect, near) {
      this.fov = fov;
      this.aspect = aspect;
      this.near = near;
      this.position = { z: 0 };
      this.updateProjectionMatrix = () => {};
      camera = this;
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
  class Points { constructor() { this.rotation = { x: 0, y: 0, z: 0 }; } }
  class PointsMaterial {}

  const context = vm.createContext({
    window,
    document: { getElementById: () => ({}) },
    THREE: { WebGLRenderer, PerspectiveCamera, BufferAttribute, BufferGeometry, Scene, Points, PointsMaterial },
    requestAnimationFrame(fn) { frame = fn; return 0; },
    console,
    Math,
    Float32Array,
  });
  vm.runInContext(SKETCH, context, { filename: 'sketch.js' });
  return {
    positions: geometry.attributes.position.array,
    camera,
    window,
    listeners,
    frame: (timestamp) => frame(timestamp),
  };
}

function halfAngles(camera) {
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  return { tanHalf, tanHalfX: tanHalf * camera.aspect };
}

function assertInsideFrustum(positions, camera) {
  const { tanHalf, tanHalfX } = halfAngles(camera);
  const camZ = camera.position.z;
  assert.ok(camZ > 0, 'the camera has to look down -Z from a positive z');

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const depth = camZ - z;
    assert.ok(depth > camera.near, 'particle ' + i / 3 + ' is behind the near plane: depth ' + depth);
    assert.ok(
      Math.abs(y) <= depth * tanHalf + 1e-4,
      'particle ' + i / 3 + ' is above the vertical frustum: |y| ' + Math.abs(y) + ' > ' + depth * tanHalf,
    );
    assert.ok(
      Math.abs(x) <= depth * tanHalfX + 1e-4,
      'particle ' + i / 3 + ' is outside the horizontal frustum: |x| ' + Math.abs(x) + ' > ' + depth * tanHalfX,
    );
  }
}

test('every seeded particle starts inside the camera frustum', () => {
  const { positions, camera } = makeSketch();
  assertInsideFrustum(positions, camera);
});

test('a resize to a narrower viewport pulls the cloud back inside', () => {
  const { positions, camera, window, listeners, frame } = makeSketch();
  window.innerWidth = 400;
  window.innerHeight = 800;
  listeners.get('resize')();

  // The wrap runs every frame, so one tick moves anything now outside the
  // shrunken box back through the opposite face.
  frame(0);

  assert.equal(camera.aspect, 0.5);
  assertInsideFrustum(positions, camera);
});

test('the seeding box stays inside the frustum at every spin angle', () => {
  // points.rotation.y grows without bound, so each particle sweeps a circle
  // of radius hypot(x, z) around the Y axis. The worst case for containment
  // is the depth where that circle turns straight at the camera.
  const { positions, camera } = makeSketch();
  const { tanHalf, tanHalfX } = halfAngles(camera);
  const camZ = camera.position.z;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const radius = Math.hypot(x, z);
    assert.ok(radius < camZ, 'particle ' + i / 3 + ' spins through the camera');

    const nearestDepth = camZ - radius;
    assert.ok(
      Math.abs(y) <= nearestDepth * tanHalf + 1e-4,
      'particle ' + i / 3 + ' leaves the vertical frustum while spinning: |y| ' + Math.abs(y),
    );
    // x/z split at the angle where the lateral offset is largest relative to
    // the remaining depth; that ratio is (r/camZ) / sqrt(1 - (r/camZ)^2).
    const ratio = radius / camZ;
    const lateral = ratio / Math.sqrt(1 - ratio * ratio);
    assert.ok(
      lateral <= tanHalfX + 1e-4,
      'particle ' + i / 3 + ' leaves the horizontal frustum while spinning: ratio ' + lateral,
    );
  }
});
