import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Scene Setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector('#bg'),
  antialias: false,
  powerPreference: "high-performance",
  alpha: true
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.5;
camera.position.set(0, 5, 30); // Start slightly above to see the "elongated" shape

// --- Post Processing (Bloom) ---
const renderScene = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0.2; // Higher threshold
bloomPass.strength = 0.4; // Low strength
bloomPass.radius = 0.2;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// --- Raymarched Black Hole & Stars ---
// We render everything in a single shader for correct warping and performance.

const bhVertexShader = `
  varying vec2 vUv;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;
  
  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const bhFragmentShader = `
  uniform float uTime;
  uniform vec3 uCameraPos;
  uniform vec3 uColorInner;
  uniform vec3 uColorOuter;

  varying vec3 vWorldPosition;

  // Performance Settings
  #define MAX_STEPS 60      // Reduced from 100
  #define STEP_SIZE 0.3     // Increased step size
  #define BH_RADIUS 2.0
  #define DISK_INNER 3.5
  #define DISK_OUTER 7.5
  
  // Fast Hash for stars
  float hash(vec3 p) {
    p  = fract( p*0.3183099+.1 );
    p *= 17.0;
    return fract( p.x*p.y*p.z*(p.x+p.y+p.z) );
  }

  // Simplex noise for disk (Optimized)
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  vec4 getDiskColor(vec3 pos) {
    float r = length(pos);
    if (r < DISK_INNER || r > DISK_OUTER) return vec4(0.0);
    
    float rNorm = (r - DISK_INNER) / (DISK_OUTER - DISK_INNER);
    float angle = atan(pos.z, pos.x);
    
    // Animation
    float speed = 1.5 / (rNorm + 0.1);
    float rotAngle = angle + uTime * speed;
    
    // Single layer of noise for performance, but warped coordinates
    float n1 = snoise(vec2(r * 1.5, rotAngle * 3.0));
    
    float intensity = 0.5 + 0.5 * n1;
    intensity = pow(intensity, 3.0);
    
    vec3 col = mix(uColorOuter, uColorInner, intensity + (1.0 - rNorm) * 0.5);
    
    // Inner rim
    float rim = smoothstep(0.1, 0.0, rNorm);
    col += vec3(1.0) * rim * 3.0;
    
    float alpha = smoothstep(0.0, 0.1, rNorm) * smoothstep(1.0, 0.5, rNorm);
    
    // Doppler
    float doppler = 1.0 - 0.5 * (pos.x / DISK_OUTER);
    col *= doppler;
    
    return vec4(col * 4.0, alpha);
  }

  vec3 getStarfield(vec3 dir) {
    // Procedural stars based on direction
    // We use the bent direction 'dir' so stars warp automatically
    
    // Grid based approach for stability
    vec3 p = dir * 150.0; // Scale determines density
    float h = hash(floor(p));
    
    // Jitter
    vec3 f = fract(p);
    
    // Simple point stars
    // If hash > threshold, draw star
    float star = 0.0;
    if(h > 0.98) {
        float brightness = (h - 0.98) / 0.02; // Normalize 0-1
        // Circular shape
        // We need to check distance to random point in cell? 
        // Simpler: just threshold noise
        star = brightness;
    }
    
    // Add some variation
    return vec3(star);
  }

  void main() {
    vec3 ro = uCameraPos;
    vec3 rd = normalize(vWorldPosition - ro);
    
    vec3 curPos = ro;
    vec3 curDir = rd;
    
    vec4 finalColor = vec4(0.0);
    bool hitHorizon = false;
    
    // Raymarching
    for(int i = 0; i < MAX_STEPS; i++) {
      float distToCenter = length(curPos);
      
      if(distToCenter < BH_RADIUS) {
        hitHorizon = true;
        finalColor.rgb = vec3(0.0);
        finalColor.a = 1.0;
        break;
      }
      
      // Gravity (1/r^2)
      // Optimized bending
      float bend = 0.8 / (distToCenter * distToCenter + 0.01);
      vec3 toCenter = normalize(-curPos);
      curDir += toCenter * bend * STEP_SIZE;
      curDir = normalize(curDir);
      
      vec3 nextPos = curPos + curDir * STEP_SIZE;
      
      // Disk Intersection
      if(curPos.y * nextPos.y < 0.0) {
        float t = curPos.y / (curPos.y - nextPos.y);
        vec3 hitPos = mix(curPos, nextPos, t);
        vec4 diskCol = getDiskColor(hitPos);
        
        finalColor.rgb += diskCol.rgb * diskCol.a * (1.0 - finalColor.a);
        finalColor.a += diskCol.a;
        if(finalColor.a >= 0.95) break;
      }
      
      curPos = nextPos;
      
      // Early exit
      if(distToCenter > 40.0) break;
    }
    
    // Background Stars (Warped!)
    if (finalColor.a < 1.0) {
        // Use the final bent direction 'curDir' to sample stars
        vec3 stars = getStarfield(curDir);
        finalColor.rgb += stars * (1.0 - finalColor.a);
    }
    
    gl_FragColor = finalColor;
  }
`;

const bhMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uCameraPos: { value: camera.position },
    uColorInner: { value: new THREE.Color(0xaaddff) }, // Cyan
    uColorOuter: { value: new THREE.Color(0x001133) }, // Dark Blue
  },
  vertexShader: bhVertexShader,
  fragmentShader: bhFragmentShader,
  side: THREE.BackSide, // Render on the inside of the box so we can fly in
  transparent: false, // We render stars, so it's opaque
  blending: THREE.NormalBlending // We handle blending manually in shader mostly
});

// Large box to contain the effect
const bhGeometry = new THREE.BoxGeometry(100, 100, 100); // Larger box for sky
const blackHoleMesh = new THREE.Mesh(bhGeometry, bhMaterial);
scene.add(blackHoleMesh);


// --- Animation & Scroll ---
let mouseX = 0;
let mouseY = 0;
let targetX = 0;
let targetY = 0;

const windowHalfX = window.innerWidth / 2;
const windowHalfY = window.innerHeight / 2;

document.addEventListener('mousemove', (event) => {
  mouseX = (event.clientX - windowHalfX);
  mouseY = (event.clientY - windowHalfY);
});

const sections = document.querySelectorAll('section');
function checkSections() {
  const triggerBottom = window.innerHeight / 5 * 4;
  sections.forEach(section => {
    const box = section.getBoundingClientRect();
    if (box.top < triggerBottom) {
      section.classList.add('visible');
    } else {
      section.classList.remove('visible');
    }
  });
}
checkSections();
window.addEventListener('scroll', checkSections);

const clock = new THREE.Clock();

function animate() {
  const elapsedTime = clock.getElapsedTime();

  // Update uniforms
  bhMaterial.uniforms.uTime.value = elapsedTime;
  bhMaterial.uniforms.uCameraPos.value.copy(camera.position);

  targetX = mouseX * 0.001;
  targetY = mouseY * 0.001;

  const scrollY = window.scrollY;
  const maxScroll = document.body.scrollHeight - window.innerHeight;
  const scrollPercent = scrollY / maxScroll;

  // Camera Path
  // Start high and far to see the "elongated" disk shape
  const p1 = { x: 0, y: 6, z: 35 };
  const p2 = { x: 8, y: 3, z: 18 };
  const p3 = { x: -6, y: -2, z: 10 };
  const p4 = { x: 0, y: 0, z: 5 };

  let targetPos = new THREE.Vector3();

  if (scrollPercent < 0.33) {
    const t = scrollPercent / 0.33;
    targetPos.lerpVectors(new THREE.Vector3(p1.x, p1.y, p1.z), new THREE.Vector3(p2.x, p2.y, p2.z), t);
  } else if (scrollPercent < 0.66) {
    const t = (scrollPercent - 0.33) / 0.33;
    targetPos.lerpVectors(new THREE.Vector3(p2.x, p2.y, p2.z), new THREE.Vector3(p3.x, p3.y, p3.z), t);
  } else {
    const t = (scrollPercent - 0.66) / 0.34;
    targetPos.lerpVectors(new THREE.Vector3(p3.x, p3.y, p3.z), new THREE.Vector3(p4.x, p4.y, p4.z), t);
  }

  camera.position.x += (targetPos.x - camera.position.x) * 0.05 + (targetX - camera.rotation.y) * 0.5;
  camera.position.y += (targetPos.y - camera.position.y) * 0.05 + (targetY - camera.rotation.x) * 0.5;
  camera.position.z += (targetPos.z - camera.position.z) * 0.05;

  camera.lookAt(0, 0, 0);

  composer.render();
  requestAnimationFrame(animate);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
