import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Scene Setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000);
const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector('#bg'),
  antialias: false,
  powerPreference: "high-performance"
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
// Start with a good viewing angle - slightly above and to the side
camera.position.set(5, 8, 25);

// --- Post Processing (Bloom) ---
const renderScene = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0.5;
bloomPass.strength = 0.15;
bloomPass.radius = 0.2;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// --- Raymarched Black Hole with Interstellar-style Banding ---
const bhVertexShader = `
  varying vec3 vWorldPosition;
  
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const bhFragmentShader = `
  uniform float uTime;
  uniform vec3 uCameraPos;
  uniform float uScrollFade; // 0 = full visibility, 1 = faded out

  varying vec3 vWorldPosition;

  // Settings
  #define MAX_STEPS 80
  #define BH_RADIUS 2.5
  #define DISK_INNER 2.8
  #define DISK_OUTER 12.0
  #define BEND_STRENGTH 1.2
  
  // Hash for stars
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  // Disk color - large, chaotic, slow, powerful bands
  vec4 getDiskColor(vec3 pos) {
    float r = length(pos.xz);
    if (r < DISK_INNER || r > DISK_OUTER) return vec4(0.0);
    
    float rNorm = (r - DISK_INNER) / (DISK_OUTER - DISK_INNER);
    float angle = atan(pos.z, pos.x);
    
    // Very slow, powerful rotation
    float speed = 0.3 / (rNorm + 0.5);
    float rotAngle = angle + uTime * speed;
    
    // Large, organic bands - only 3-4 major bands
    float bandFreq = 3.5;
    float band = sin(rNorm * bandFreq * 3.14159) * 0.5 + 0.5;
    
    // Add chaotic variation using noise-like patterns
    float chaos1 = sin(rotAngle * 2.0 + r * 0.5) * 0.3;
    float chaos2 = sin(rotAngle * 5.0 - r * 1.5 + uTime * 0.1) * 0.15;
    float chaos3 = sin(angle * 3.0 + rNorm * 8.0) * 0.2;
    
    float intensity = band + chaos1 + chaos2 + chaos3;
    intensity = clamp(intensity, 0.0, 1.0);
    intensity = pow(intensity, 1.5); // Soft contrast
    
    // Color gradient: bright warm inner -> red -> dark red outer  
    vec3 colorInner = vec3(1.0, 0.85, 0.7);    // Warm cream/peach
    vec3 colorMid = vec3(0.9, 0.35, 0.15);     // Bright red-orange
    vec3 colorOuter = vec3(0.35, 0.08, 0.02);  // Dark crimson
    
    vec3 col;
    if (rNorm < 0.35) {
      col = mix(colorInner, colorMid, rNorm / 0.35);
    } else {
      col = mix(colorMid, colorOuter, (rNorm - 0.35) / 0.65);
    }
    
    // Apply intensity variation
    col *= 0.4 + intensity * 0.6;
    
    // Bright inner rim
    float rim = smoothstep(0.12, 0.0, rNorm);
    col += vec3(1.0, 0.95, 0.9) * rim * 3.0;
    
    // Soft edges
    float alpha = smoothstep(0.0, 0.08, rNorm) * smoothstep(1.0, 0.8, rNorm);
    
    // Doppler beaming
    float doppler = 0.5 + 0.8 * clamp((pos.x / DISK_OUTER + 0.5), 0.0, 1.0);
    col *= doppler;
    
    return vec4(col * 2.0, alpha * 0.9);
  }

  vec3 getStarfield(vec3 dir) {
    vec3 p = dir * 200.0;
    float h = hash(floor(p));
    
    float star = 0.0;
    if(h > 0.985) {
      star = (h - 0.985) / 0.015;
      star = pow(star, 2.0); // Make brighter stars brighter
    }
    
    return vec3(star * 0.8);
  }

  void main() {
    vec3 ro = uCameraPos;
    vec3 rd = normalize(vWorldPosition - ro);
    
    vec3 curPos = ro;
    vec3 curDir = rd;
    
    vec4 finalColor = vec4(0.0);
    vec3 lastDir = rd;
    
    // Raymarching with adaptive step size
    for(int i = 0; i < MAX_STEPS; i++) {
      float distToCenter = length(curPos);
      
      // Adaptive step size - smaller near the hole for precision
      float stepSize = max(0.2, min(distToCenter * 0.08, 2.0));
      
      // Gravitational bending - reduced for subtlety
      float bend = 0.5 / (distToCenter * distToCenter + 0.01);
      vec3 toCenter = normalize(-curPos);
      curDir += toCenter * bend * stepSize;
      curDir = normalize(curDir);
      lastDir = curDir;
      
      vec3 nextPos = curPos + curDir * stepSize;
      float nextDist = length(nextPos);
      
      // Check disk intersection FIRST (before horizon check)
      // This ensures rays that cross the disk on their way to the hole still render
      if(curPos.y * nextPos.y < 0.0) {
        float t = abs(curPos.y) / (abs(curPos.y) + abs(nextPos.y));
        vec3 hitPos = mix(curPos, nextPos, t);
        
        vec4 diskCol = getDiskColor(hitPos);
        
        // Alpha blend
        finalColor.rgb += diskCol.rgb * diskCol.a * (1.0 - finalColor.a);
        finalColor.a += diskCol.a * (1.0 - finalColor.a);
        
        if(finalColor.a >= 0.98) break;
      }
      
      // Event Horizon check - ray fell into the black hole
      if(nextDist < BH_RADIUS) {
        // If we haven't accumulated enough disk color, fill with black
        if(finalColor.a < 0.5) {
          finalColor.rgb = vec3(0.0);
          finalColor.a = 1.0;
        }
        break;
      }
      
      curPos = nextPos;
      
      // Early exit if far away
      if(distToCenter > 80.0) break;
    }
    
    // Background stars
    if (finalColor.a < 1.0) {
      vec3 stars = getStarfield(lastDir);
      finalColor.rgb += stars * (1.0 - finalColor.a);
    }
    
    // Apply scroll fade (fade to black as we scroll)
    finalColor.rgb *= (1.0 - uScrollFade);
    
    gl_FragColor = finalColor;
  }
`;

const bhMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uCameraPos: { value: camera.position },
    uScrollFade: { value: 0 }
  },
  vertexShader: bhVertexShader,
  fragmentShader: bhFragmentShader,
  side: THREE.BackSide,
  transparent: false
});

const bhGeometry = new THREE.BoxGeometry(500, 500, 500);
const blackHoleMesh = new THREE.Mesh(bhGeometry, bhMaterial);
scene.add(blackHoleMesh);

// --- Animation & Scroll ---
let mouseX = 0;
let mouseY = 0;

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

  bhMaterial.uniforms.uTime.value = elapsedTime;
  bhMaterial.uniforms.uCameraPos.value.copy(camera.position);

  const scrollY = window.scrollY;
  const maxScroll = document.body.scrollHeight - window.innerHeight;
  const scrollPercent = Math.min(scrollY / maxScroll, 1.0);

  // Camera Path: Start viewing the black hole, then pull away into empty space
  // p1: Good viewing angle to see the elongated disk
  // p2: Move around
  // p3: Pull far back into space
  // p4: Very far, mostly black sky

  const p1 = { x: 5, y: 12, z: 30 };    // Above and to the side - see the full disk
  const p2 = { x: 15, y: 5, z: 25 };    // Orbit around
  const p3 = { x: 0, y: 2, z: 60 };     // Pull back
  const p4 = { x: 0, y: 0, z: 120 };    // Further into space

  let targetPos = new THREE.Vector3();
  let scrollFade = 0;

  if (scrollPercent < 0.3) {
    const t = scrollPercent / 0.3;
    targetPos.lerpVectors(new THREE.Vector3(p1.x, p1.y, p1.z), new THREE.Vector3(p2.x, p2.y, p2.z), t);
  } else if (scrollPercent < 0.6) {
    const t = (scrollPercent - 0.3) / 0.3;
    targetPos.lerpVectors(new THREE.Vector3(p2.x, p2.y, p2.z), new THREE.Vector3(p3.x, p3.y, p3.z), t);
  } else {
    const t = (scrollPercent - 0.6) / 0.4;
    targetPos.lerpVectors(new THREE.Vector3(p3.x, p3.y, p3.z), new THREE.Vector3(p4.x, p4.y, p4.z), t);
    // Start fading to black in the last phase
    scrollFade = t * 0.8; // Max 80% fade
  }

  bhMaterial.uniforms.uScrollFade.value = scrollFade;

  // Smooth camera movement
  const mouseDampX = mouseX * 0.0005;
  const mouseDampY = mouseY * 0.0005;

  camera.position.x += (targetPos.x - camera.position.x) * 0.03 + mouseDampX;
  camera.position.y += (targetPos.y - camera.position.y) * 0.03 + mouseDampY;
  camera.position.z += (targetPos.z - camera.position.z) * 0.03;

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
