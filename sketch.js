// Flow-field particle system
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.z = 30;

// The canvas and camera are sized from the viewport at boot and on every
// resize, so the field always fills the window without stretching. The pixel
// ratio is refreshed here too: dragging the window to a different-DPI monitor
// fires a resize, and a stale ratio leaves the drawing buffer blurry.
function updateViewport() {
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
}
updateViewport();
window.addEventListener('resize', updateViewport);

const N = 8000;
const BOUND = 30; // half-extent of the seeding box; particles wrap here
const positions = new Float32Array(N * 3);
const velocities = new Float32Array(N * 3);
for (let i = 0; i < N; i++) {
  positions[i * 3] = (Math.random() - 0.5) * 2 * BOUND;
  positions[i * 3 + 1] = (Math.random() - 0.5) * 2 * BOUND;
  positions[i * 3 + 2] = (Math.random() - 0.5) * 2 * BOUND;
}
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const mat = new THREE.PointsMaterial({ size: 0.12, color: 0x8ab4ff, transparent: true, opacity: 0.85 });
const points = new THREE.Points(geo, mat);
scene.add(points);

function noise(x, y, z) {
  return Math.sin(x * 0.35) * Math.cos(y * 0.35) * Math.sin(z * 0.35);
}

// Integrator constants are quoted per 1/60 s step, the rate they were tuned
// at. Each frame scales them by the wall-clock time that actually elapsed, so
// the field covers the same ground per second on a 60 Hz and a 144 Hz display
// instead of running 2.4x faster on the faster panel.
const ACCEL = 0.004;
const DAMPING = 0.96;
const MAX_STEP = 1 / 30; // clamp: a backgrounded tab must not teleport the field

let last = null;   // previous frame timestamp, null until the first frame
let elapsed = 0;   // seconds of simulated time since boot

function tick(now) {
  const pos = geo.attributes.position.array;
  // Frame timestamps are milliseconds since page load; the simulation only
  // ever sees the difference, so the first frame starts at zero no matter how
  // long the page had been open, and a throttled tab advances by the clamp.
  const dt = last === null ? 0 : Math.min(Math.max((now - last) / 1000, 0), MAX_STEP);
  last = now;
  elapsed += dt;
  const step = dt * 60;                 // frames' worth of 1/60 s steps
  const damping = Math.pow(DAMPING, step);
  for (let i = 0; i < N; i++) {
    const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2;
    const n = noise(pos[ix] * 0.1 + elapsed * 0.05, pos[iy] * 0.1, pos[iz] * 0.1);
    velocities[ix] += Math.cos(n * 6) * ACCEL * step;
    velocities[iy] += Math.sin(n * 6) * ACCEL * step;
    velocities[iz] += Math.sin(n * 3) * ACCEL * step;
    pos[ix] += velocities[ix] * step; pos[iy] += velocities[iy] * step; pos[iz] += velocities[iz] * step;
    velocities[ix] *= damping; velocities[iy] *= damping; velocities[iz] *= damping;
    // Wrap instead of respawning: the particle re-enters on the opposite face
    // with its velocity intact rather than jumping to a random spot, so the
    // field keeps its density and the motion reads as one continuous flow.
    while (pos[ix] > BOUND) pos[ix] -= BOUND * 2; while (pos[ix] < -BOUND) pos[ix] += BOUND * 2;
    while (pos[iy] > BOUND) pos[iy] -= BOUND * 2; while (pos[iy] < -BOUND) pos[iy] += BOUND * 2;
    while (pos[iz] > BOUND) pos[iz] -= BOUND * 2; while (pos[iz] < -BOUND) pos[iz] += BOUND * 2;
  }
  geo.attributes.position.needsUpdate = true;
  points.rotation.y = elapsed * 0.02;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
