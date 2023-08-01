// Flow-field particle system
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.z = 30;

const N = 8000;
const positions = new Float32Array(N * 3);
const velocities = new Float32Array(N * 3);
for (let i = 0; i < N; i++) {
  positions[i * 3] = (Math.random() - 0.5) * 60;
  positions[i * 3 + 1] = (Math.random() - 0.5) * 60;
  positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
}
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const mat = new THREE.PointsMaterial({ size: 0.12, color: 0x8ab4ff, transparent: true, opacity: 0.85 });
const points = new THREE.Points(geo, mat);
scene.add(points);

function noise(x, y, z) {
  return Math.sin(x * 0.35) * Math.cos(y * 0.35) * Math.sin(z * 0.35);
}

function tick(t) {
  const pos = geo.attributes.position.array;
  for (let i = 0; i < N; i++) {
    const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2;
    const n = noise(pos[ix] * 0.1 + t * 0.05, pos[iy] * 0.1, pos[iz] * 0.1);
    velocities[ix] += Math.cos(n * 6) * 0.004;
    velocities[iy] += Math.sin(n * 6) * 0.004;
    velocities[iz] += Math.sin(n * 3) * 0.004;
    pos[ix] += velocities[ix]; pos[iy] += velocities[iy]; pos[iz] += velocities[iz];
    velocities[ix] *= 0.96; velocities[iy] *= 0.96; velocities[iz] *= 0.96;
  }
  geo.attributes.position.needsUpdate = true;
  points.rotation.y = t * 0.02;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
