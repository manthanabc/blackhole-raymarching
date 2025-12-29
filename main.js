import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import GUI from 'lil-gui';

// === CONFIGURABLE PARAMETERS ===
const params = {
  // Camera
  cameraX: 5,
  cameraY: 12,
  cameraZ: 30,
  fov: 42.6,

  // Black Hole
  bhRadius: 1.65,
  diskInner: 1.477,
  diskOuter: 11.25,
  bendStrength: 0.5,

  // Disk Appearance
  rotationSpeed: 0.3,
  bandFrequency: 1.7,
  diskBrightness: 1.679,

  // Bloom
  bloomThreshold: 0.15,
  bloomStrength: 0.28,
  bloomRadius: 0.484,

  // Animation
  autoRotate: false,
  scrollEnabled: true
};

// Scene Setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(params.fov, window.innerWidth / window.innerHeight, 0.1, 50000);
const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector('#bg'),
  antialias: false,
  powerPreference: "high-performance"
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
camera.position.set(params.cameraX, params.cameraY, params.cameraZ);

// --- Post Processing (Bloom) ---
const renderScene = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = params.bloomThreshold;
bloomPass.strength = params.bloomStrength;
bloomPass.radius = params.bloomRadius;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// --- Raymarched Black Hole ---
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
  uniform float uScrollFade;
  
  // Configurable uniforms
  uniform float uBhRadius;
  uniform float uDiskInner;
  uniform float uDiskOuter;
  uniform float uBendStrength;
  uniform float uRotationSpeed;
  uniform float uBandFrequency;
  uniform float uDiskBrightness;

  varying vec3 vWorldPosition;

  #define MAX_STEPS 80
  
  // Hash for stars
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  // Disk color
  vec4 getDiskColor(vec3 pos) {
    float r = length(pos.xz);
    if (r < uDiskInner || r > uDiskOuter) return vec4(0.0);
    
    float rNorm = (r - uDiskInner) / (uDiskOuter - uDiskInner);
    float angle = atan(pos.z, pos.x);
    
    // Slow, powerful rotation
    float speed = uRotationSpeed / (rNorm + 0.5);
    float rotAngle = angle + uTime * speed;
    
    // Large, organic bands
    float band = sin(rNorm * uBandFrequency * 3.14159) * 0.5 + 0.5;
    
    // Chaotic variation
    float chaos1 = sin(rotAngle * 2.0 + r * 0.5) * 0.3;
    float chaos2 = sin(rotAngle * 5.0 - r * 1.5 + uTime * 0.1) * 0.15;
    float chaos3 = sin(angle * 3.0 + rNorm * 8.0) * 0.2;
    
    float intensity = band + chaos1 + chaos2 + chaos3;
    intensity = clamp(intensity, 0.0, 1.0);
    intensity = pow(intensity, 1.5);
    
    // Color gradient
    vec3 colorInner = vec3(1.0, 0.85, 0.7);
    vec3 colorMid = vec3(0.9, 0.35, 0.15);
    vec3 colorOuter = vec3(0.35, 0.08, 0.02);
    
    vec3 col;
    if (rNorm < 0.35) {
      col = mix(colorInner, colorMid, rNorm / 0.35);
    } else {
      col = mix(colorMid, colorOuter, (rNorm - 0.35) / 0.65);
    }
    
    col *= 0.4 + intensity * 0.6;
    
    // Bright inner rim
    float rim = smoothstep(0.12, 0.0, rNorm);
    col += vec3(1.0, 0.95, 0.9) * rim * 3.0;
    
    // Soft edges
    float alpha = smoothstep(0.0, 0.08, rNorm) * smoothstep(1.0, 0.8, rNorm);
    
    // Doppler beaming
    float doppler = 0.5 + 0.8 * clamp((pos.x / uDiskOuter + 0.5), 0.0, 1.0);
    col *= doppler;
    
    return vec4(col * uDiskBrightness, alpha * 0.9);
  }

  vec3 getStarfield(vec3 dir) {
    vec3 p = dir * 300.0;  // Higher density grid
    float h = hash(floor(p));
    
    float star = 0.0;
    if(h > 0.995) {  // Much rarer stars
      star = (h - 0.995) / 0.005;
      star = pow(star, 3.0);  // Sharper falloff
    }
    
    return vec3(star * 0.4);  // Dimmer
  }

  void main() {
    vec3 ro = uCameraPos;
    vec3 rd = normalize(vWorldPosition - ro);
    
    vec3 curPos = ro;
    vec3 curDir = rd;
    
    vec4 finalColor = vec4(0.0);
    vec3 lastDir = rd;
    
    for(int i = 0; i < MAX_STEPS; i++) {
      float distToCenter = length(curPos);
      
      float stepSize = max(0.2, min(distToCenter * 0.08, 2.0));
      
      // Gravitational bending
      float bend = uBendStrength / (distToCenter * distToCenter + 0.01);
      vec3 toCenter = normalize(-curPos);
      curDir += toCenter * bend * stepSize;
      curDir = normalize(curDir);
      lastDir = curDir;
      
      vec3 nextPos = curPos + curDir * stepSize;
      float nextDist = length(nextPos);
      
      // Disk intersection
      if(curPos.y * nextPos.y < 0.0) {
        float t = abs(curPos.y) / (abs(curPos.y) + abs(nextPos.y));
        vec3 hitPos = mix(curPos, nextPos, t);
        
        vec4 diskCol = getDiskColor(hitPos);
        
        finalColor.rgb += diskCol.rgb * diskCol.a * (1.0 - finalColor.a);
        finalColor.a += diskCol.a * (1.0 - finalColor.a);
        
        if(finalColor.a >= 0.98) break;
      }
      
      // Event Horizon
      if(nextDist < uBhRadius) {
        if(finalColor.a < 0.5) {
          finalColor.rgb = vec3(0.0);
          finalColor.a = 1.0;
        }
        break;
      }
      
      curPos = nextPos;
      
      if(distToCenter > 80.0) break;
    }
    
    // Background stars
    if (finalColor.a < 1.0) {
      vec3 stars = getStarfield(lastDir);
      finalColor.rgb += stars * (1.0 - finalColor.a);
    }
    
    finalColor.rgb *= (1.0 - uScrollFade);
    
    gl_FragColor = finalColor;
  }
`;

const bhMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uCameraPos: { value: camera.position },
    uScrollFade: { value: 0 },
    uBhRadius: { value: params.bhRadius },
    uDiskInner: { value: params.diskInner },
    uDiskOuter: { value: params.diskOuter },
    uBendStrength: { value: params.bendStrength },
    uRotationSpeed: { value: params.rotationSpeed },
    uBandFrequency: { value: params.bandFrequency },
    uDiskBrightness: { value: params.diskBrightness }
  },
  vertexShader: bhVertexShader,
  fragmentShader: bhFragmentShader,
  side: THREE.BackSide,
  transparent: false
});

const bhGeometry = new THREE.BoxGeometry(500, 500, 500);
const blackHoleMesh = new THREE.Mesh(bhGeometry, bhMaterial);
scene.add(blackHoleMesh);

// === GUI SETUP ===
const gui = new GUI({ title: 'Black Hole Controls' });

// Camera folder
const cameraFolder = gui.addFolder('Camera');
cameraFolder.add(params, 'cameraX', -50, 50).name('X Position').onChange(v => {
  if (!params.scrollEnabled) camera.position.x = v;
});
cameraFolder.add(params, 'cameraY', -50, 50).name('Y Position').onChange(v => {
  if (!params.scrollEnabled) camera.position.y = v;
});
cameraFolder.add(params, 'cameraZ', 5, 150).name('Z Position').onChange(v => {
  if (!params.scrollEnabled) camera.position.z = v;
});
cameraFolder.add(params, 'fov', 30, 120).name('FOV').onChange(v => {
  camera.fov = v;
  camera.updateProjectionMatrix();
});

// Black Hole folder
const bhFolder = gui.addFolder('Black Hole');
bhFolder.add(params, 'bhRadius', 1, 5).name('Event Horizon').onChange(v => {
  bhMaterial.uniforms.uBhRadius.value = v;
});
bhFolder.add(params, 'diskInner', 1, 10).name('Disk Inner').onChange(v => {
  bhMaterial.uniforms.uDiskInner.value = v;
});
bhFolder.add(params, 'diskOuter', 5, 30).name('Disk Outer').onChange(v => {
  bhMaterial.uniforms.uDiskOuter.value = v;
});
bhFolder.add(params, 'bendStrength', 0, 3).name('Gravity Bend').onChange(v => {
  bhMaterial.uniforms.uBendStrength.value = v;
});

// Disk Appearance folder
const diskFolder = gui.addFolder('Disk Appearance');
diskFolder.add(params, 'rotationSpeed', 0, 2).name('Rotation Speed').onChange(v => {
  bhMaterial.uniforms.uRotationSpeed.value = v;
});
diskFolder.add(params, 'bandFrequency', 1, 10).name('Band Frequency').onChange(v => {
  bhMaterial.uniforms.uBandFrequency.value = v;
});
diskFolder.add(params, 'diskBrightness', 0.5, 5).name('Brightness').onChange(v => {
  bhMaterial.uniforms.uDiskBrightness.value = v;
});

// Bloom folder
const bloomFolder = gui.addFolder('Bloom');
bloomFolder.add(params, 'bloomThreshold', 0, 1).name('Threshold').onChange(v => {
  bloomPass.threshold = v;
});
bloomFolder.add(params, 'bloomStrength', 0, 2).name('Strength').onChange(v => {
  bloomPass.strength = v;
});
bloomFolder.add(params, 'bloomRadius', 0, 1).name('Radius').onChange(v => {
  bloomPass.radius = v;
});

// Animation folder
const animFolder = gui.addFolder('Animation');
animFolder.add(params, 'scrollEnabled').name('Scroll Control');
animFolder.add(params, 'autoRotate').name('Auto Rotate');

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
let autoRotateAngle = 0;

function animate() {
  const elapsedTime = clock.getElapsedTime();

  bhMaterial.uniforms.uTime.value = elapsedTime;
  bhMaterial.uniforms.uCameraPos.value.copy(camera.position);

  if (params.scrollEnabled) {
    const scrollY = window.scrollY;
    const maxScroll = document.body.scrollHeight - window.innerHeight;
    const scrollPercent = Math.min(scrollY / maxScroll, 1.0);

    const p2 = { x: 5, y: 12, z: 30 };
    const p1 = { x: 15, y: 5, z: 25 };
    const p3 = { x: 0, y: 2, z: 60 };
    const p4 = { x: 0, y: 0, z: 120 };

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
      scrollFade = t * 0.8;
    }

    bhMaterial.uniforms.uScrollFade.value = scrollFade;

    const mouseDampX = mouseX * 0.0005;
    const mouseDampY = (-100 + mouseY) * 0.0001;

    camera.position.x += (targetPos.x - camera.position.x) * 0.03 + mouseDampX;
    camera.position.y += (targetPos.y - camera.position.y) * 0.03 + mouseDampY;
    camera.position.z += (targetPos.z - camera.position.z) * 0.03;

    // Update GUI display
    params.cameraX = camera.position.x;
    params.cameraY = camera.position.y;
    params.cameraZ = camera.position.z;
  } else if (params.autoRotate) {
    autoRotateAngle += 0.005;
    const radius = params.cameraZ;
    camera.position.x = Math.sin(autoRotateAngle) * radius * 0.3;
    camera.position.z = Math.cos(autoRotateAngle) * radius;
    camera.position.y = params.cameraY;
    bhMaterial.uniforms.uScrollFade.value = 0;
  } else {
    camera.position.set(params.cameraX, params.cameraY, params.cameraZ);
    bhMaterial.uniforms.uScrollFade.value = 0;
  }

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
