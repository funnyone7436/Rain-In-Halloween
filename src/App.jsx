// src/App.jsx
import React, { useMemo, useState, useEffect, useRef, Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Line, useGLTF, Environment, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'

/* ========================= Constants ========================= */
const RADIUS = 18
const COUNT = 20
const MAX_JUMP = 3.0
const LERP_POS = 0.2
const LERP_SCALE = 0.2
const TARGET_VOL = 0.5
const CONTENT_Y = 2.0
const BASE = import.meta.env.BASE_URL; // works locally and on GitHub Pages


/* ===== Toggle the rainbow waves on/off here ===== */
const SHOW_WAVES = false // <- set true to show waves, false to hide

/* ======= Editable list of game titles & URLs (add more here!) ======= */
const GAMES = [
  { title: 'Jumping Zombie Game', href: 'https://funnyone7436.github.io/zombie-jump-game/' },
  { title: 'Jumping Minecraft Game', href: 'https://funnyone7436.github.io/Dance-with-Minecraft-block/' },
  { title: 'Jumping Fireworks Game', href: 'https://funnyone7436.github.io/fireworks-gesture-game/' },
  { title: 'Rainbow Caterpillar Game', href: 'https://funnyone7436.github.io/Dancing-With-Hungry-Rainbow-Caterpillar/' },
]

/* ========================= Helpers =========================== */
function hexToThreeColor(hex) { return new THREE.Color(hex) }
function clamp01(x) { x = Number(x); if (Number.isNaN(x)) return 1; return Math.min(1, Math.max(0, x)) }
function validateEnv(obj, fallback) {
  const safe = { ...fallback }
  if (!obj || typeof obj !== 'object') return safe
  const ALLOWED_PRESETS = ['apartment','city','dawn','forest','lobby','night','park','studio','sunset','warehouse']
  const keys = Object.keys(fallback)
  for (const k of keys) {
    const v = obj[k]; if (v === undefined) continue
    if (/_Alpha$/.test(k)) safe[k] = clamp01(v)
    else if (['hemiEnabled','dirEnabled','rimEnabled'].includes(k)) safe[k] = !!v
    else if ([
      'dirIntensity','gradientExponent','fogNear','fogFar','fogDensity',
      'envIntensity','ambientIntensity','hemiIntensity',
      'sunAzimuth','sunElevation','rimIntensity','rimAzimuth','rimElevation'
    ].includes(k)) safe[k] = Number(v)
    else if (k === 'fogType' && (v === 'linear' || v === 'exp2')) safe[k] = v
    else if (k === 'envPreset') safe[k] = ALLOWED_PRESETS.includes(String(v)) ? String(v) : fallback.envPreset
    else if (typeof v === 'string') safe[k] = v
  }
  return safe
}

/* Normalize scale from number | [x,y,z] | {x,y,z} to {x,y,z} */
function normalizeScale(scale) {
  if (typeof scale === 'number') { const s = Number.isFinite(scale) ? scale : 1; return { x: s, y: s, z: s } }
  if (Array.isArray(scale)) { const [x = 1, y = 1, z = 1] = scale; return { x: Number(x) || 1, y: Number(y) || 1, z: Number(z) || 1 } }
  if (scale && typeof scale === 'object') {
    const x = Number(scale.x ?? 1), y = Number(scale.y ?? 1), z = Number(scale.z ?? 1)
    return { x: Number.isFinite(x) ? x : 1, y: Number.isFinite(y) ? y : 1, z: Number.isFinite(z) ? z : 1 }
  }
  return { x: 1, y: 1, z: 1 }
}

/* ====================== Mini Components ====================== */
function SineCircle({
  radius = 20, segments = 300, speed = 0.5, amplitude = 6, phase = 0,
  color = '#FF5733', thickness = 0.02,
}) {
  const lineRef = useRef()
  const positions = useMemo(() => {
    const arr = new Float32Array((segments + 1) * 3)
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      const idx = i * 3
      arr[idx + 0] = Math.cos(a) * radius
      arr[idx + 1] = 0
      arr[idx + 2] = Math.sin(a) * radius
    }
    return arr
  }, [radius, segments])

  const initialPoints = useMemo(() => {
    const pts = []
    for (let i = 0; i <= segments; i++) {
      const idx = i * 3
      pts.push(new THREE.Vector3(positions[idx], 0, positions[idx + 2]))
    }
    return pts
  }, [positions, segments])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * speed
    for (let i = 0; i <= segments; i++) {
      const idx = i * 3
      const a = (i / segments) * Math.PI * 2
      positions[idx + 1] = Math.sin(a * 2 + t + phase) * amplitude
    }
    const geom = lineRef.current?.geometry
    if (geom?.setPositions) geom.setPositions(positions)
  })

  return (
    <Line
      ref={lineRef}
      points={initialPoints}
      color={color}
      lineWidth={thickness}
      worldUnits
      transparent
      opacity={0.95}
    />
  )
}

/* ================ Utility for ring placement ================ */
function ringPositions(count, radius) {
  const pts = []
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    pts.push([Math.cos(a) * radius, 0, Math.sin(a) * radius])
  }
  return pts
}

/* =================== Background + Sun/Hemi =================== */
function ExampleBackground({
  skyTop, skyTopAlpha,
  skyBottom, skyBottomAlpha,
  groundColor, groundAlpha,
  sunColor,
  hemiEnabled, dirEnabled, dirIntensity,
  hemiIntensity, sunAzimuth, sunElevation,
  fogType, fogNear, fogFar, fogDensity,
  gradientExponent,
}) {
  const { scene, gl } = useThree()

  useEffect(() => {
    if ('outputEncoding' in gl) gl.outputEncoding = THREE.sRGBEncoding
    if ('outputColorSpace' in gl) gl.outputColorSpace = THREE.SRGBColorSpace
    THREE.ColorManagement.legacyMode = true
    gl.toneMapping = THREE.NoToneMapping
    gl.toneMappingExposure = 1.0
    gl.physicallyCorrectLights = false
    gl.shadowMap.enabled = true
    gl.shadowMap.type = THREE.PCFSoftShadowMap
  }, [gl])

  useEffect(() => {
    scene.background = null
    const fogCol = hexToThreeColor(groundColor)
    if (fogType === 'exp2') {
      scene.fog = new THREE.FogExp2(fogCol, Math.max(0, Number(fogDensity) || 0))
    } else {
      scene.fog = new THREE.Fog(fogCol, Math.max(0, Number(fogNear) || 1), Math.max(1, Number(fogFar) || 1000))
    }
  }, [scene, fogType, groundColor, fogNear, fogFar, fogDensity])

  const uniforms = useMemo(() => ({
    topColor:    { value: hexToThreeColor(skyTop) },
    bottomColor: { value: hexToThreeColor(skyBottom) },
    topAlpha:    { value: skyTopAlpha },
    bottomAlpha: { value: skyBottomAlpha },
    offset:      { value: 33.0 },
    exponent:    { value: gradientExponent },
  }), [skyTop, skyBottom, skyTopAlpha, skyBottomAlpha, gradientExponent])

  const skyMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec3 vWorldPosition;
      void main(){
        vWorldPosition = (modelMatrix * vec4(position,1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor, bottomColor;
      uniform float topAlpha, bottomAlpha;
      uniform float offset, exponent;
      varying vec3 vWorldPosition;
      void main(){
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        float m = pow(max(h, 0.0), exponent);
        vec3 col = mix(bottomColor, topColor, m);
        float a = mix(bottomAlpha, topAlpha, m);
        gl_FragColor = vec4(col, a);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
  }), [uniforms])

  const hemiRef = useRef(null)
  const dirRef  = useRef(null)
  const targetRef = useRef(null)

  useEffect(() => {
    if (hemiRef.current) {
      hemiRef.current.visible = hemiEnabled
      hemiRef.current.color = hexToThreeColor(skyTop)
      hemiRef.current.groundColor = hexToThreeColor(groundColor)
      hemiRef.current.intensity = hemiIntensity
    }
    if (dirRef.current) {
      dirRef.current.visible = dirEnabled
      dirRef.current.color = hexToThreeColor(sunColor)
      dirRef.current.intensity = dirIntensity

      const r = 90
      const elev = THREE.MathUtils.degToRad(sunElevation)
      const az   = THREE.MathUtils.degToRad(sunAzimuth)
      const y = Math.sin(elev) * r
      const h = Math.cos(elev) * r
      const x = Math.cos(az) * h
      const z = Math.sin(az) * h
      dirRef.current.position.set(x, y, z)

      if (targetRef.current) {
        targetRef.current.position.set(0, CONTENT_Y, 0)
        dirRef.current.target = targetRef.current
        dirRef.current.target.updateMatrixWorld()
      }

      dirRef.current.castShadow = true
      const d = 60
      const c = dirRef.current.shadow.camera
      c.left = -d; c.right = d; c.top = d; c.bottom = -d
      c.near = 1; c.far = 200
      dirRef.current.shadow.mapSize.set(2048, 2048)
      dirRef.current.shadow.bias = -0.00025
      dirRef.current.shadow.normalBias = 0.02
      c.updateProjectionMatrix()
    }
  }, [hemiEnabled, dirEnabled, skyTop, groundColor, sunColor, dirIntensity, hemiIntensity, sunAzimuth, sunElevation])

  return (
    <>
      <object3D ref={targetRef} />
      {hemiEnabled && (
        <hemisphereLight
          ref={hemiRef}
          args={[hexToThreeColor(skyTop), hexToThreeColor(groundColor), 0.3]}
          position={[0, 50, 0]}
        />
      )}
      {dirEnabled && <directionalLight ref={dirRef} />}

      {/* Skydome */}
      <mesh>
        <sphereGeometry args={[4000, 32, 15]} />
        <primitive object={skyMat} attach="material" />
      </mesh>

      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[10000, 10000]} />
        <meshStandardMaterial
          color={groundColor}
          transparent
          opacity={THREE.MathUtils.clamp(groundAlpha, 0, 1)}
        />
      </mesh>
    </>
  )
}

/* ================= Optional Rim Light ================= */
function RimLight({ enabled, color='#ffffff', intensity=0, azimuth=220, elevation=25 }) {
  const ref = useRef()
  const target = useRef()
  useEffect(() => {
    if (!ref.current) return
    const r = 60
    const elev = THREE.MathUtils.degToRad(elevation)
    const az   = THREE.MathUtils.degToRad(azimuth)
    const y = Math.sin(elev) * r
    const h = Math.cos(elev) * r
    const x = Math.cos(az) * h
    const z = Math.sin(az) * h
    ref.current.position.set(x, y, z)
    if (target.current) {
      target.current.position.set(0, CONTENT_Y, 0)
      ref.current.target = target.current
      ref.current.target.updateMatrixWorld()
    }
  }, [azimuth, elevation])
  if (!enabled || intensity <= 0) return null
  return (
    <>
      <object3D ref={target} />
      <directionalLight
        ref={ref}
        color={color}
        intensity={intensity}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0002}
      />
    </>
  )
}

/* =================== Configurable Models ring =================== */
function ConfigurableModelsRing({ audioRef, modelsSettings }) {
  const positions = useMemo(() => ringPositions(modelsSettings.length, RADIUS), [modelsSettings.length])

  // Preload unique model files (safe: useGLTF.preload is a function, not a hook)
  useEffect(() => {
    const unique = Array.from(new Set(modelsSettings.map(m => m.file)))
    unique.forEach(file => useGLTF.preload(`${BASE}objs/${file}`))
  }, [modelsSettings])

  // Rebuild refs if the number of models changes
  const groupRefs = useMemo(
    () => modelsSettings.map(() => React.createRef()),
    [modelsSettings.length]
  )

  const [spec, setSpec] = useState(null)
  const [frameDur, setFrameDur] = useState(0.02)
  const [bandMax, setBandMax] = useState(null)

  // Load spectrum JSON
  useEffect(() => {
    let cancelled = false
    fetch(`${BASE}childrenbackgroundmusic.json`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.length) return
        setSpec(data)
        const fd = data.length > 1 ? Math.max(0.0001, data[1].t - data[0].t) : 0.02
        setFrameDur(fd)
        const bandsN = data[0].bands.length
        const maxes = new Array(bandsN).fill(0)
        for (let i = 0; i < data.length; i++) {
          const b = data[i].bands
          for (let j = 0; j < bandsN; j++) maxes[j] = Math.max(maxes[j], b[j])
        }
        for (let j = 0; j < maxes.length; j++) maxes[j] = Math.max(maxes[j], 1e-6)
        setBandMax(maxes)
      })
      .catch((err) => console.error('Failed to load childrenbackgroundmusic.json', err))
    return () => { cancelled = true }
  }, [])

  // Animation by audio (jump + stretch Y) relative to each model's yOffset
  useFrame(() => {
    if (!spec || !bandMax) return
    const audio = audioRef?.current
    if (!audio) return
    const t = audio.currentTime || 0
    const idx = Math.min(spec.length - 1, Math.floor(t / frameDur))
    const bands = spec[idx].bands
    for (let i = 0; i < modelsSettings.length; i++) {
      const g = groupRefs[i]?.current
      if (!g) continue
      const raw = bands[i] ?? 0
      const norm = THREE.MathUtils.clamp(raw / bandMax[i], 0, 1)
      const jump = norm * MAX_JUMP
      const baseY = Number(modelsSettings[i]?.yOffset ?? 0)
      const targetY = baseY + jump
      g.position.y = THREE.MathUtils.lerp(g.position.y, targetY, LERP_POS)
      g.scale.y = THREE.MathUtils.lerp(g.scale.y, 1 + norm * 0.35, LERP_SCALE)
    }
  })

  return modelsSettings.map((setting, i) => {
    const pos = positions[i]
    const angle = (i / modelsSettings.length) * Math.PI * 2
    const yOffset = Number(setting.yOffset ?? 0)
    return (
      <ModelInstance
        key={`${setting.file}-${i}`}
        ref={groupRefs[i]}
        file={setting.file}
        scaleSetting={setting.scale}
        rotYdeg={setting.rotYdeg}
        position={[pos[0], yOffset, pos[2]]}
        baseRotationY={-angle + Math.PI / 2} // face the ring center
      />
    )
  })
}

// Helper component for a single model instance
const ModelInstance = React.forwardRef(function ModelInstance(
  { file, scaleSetting = 1, rotYdeg = 0, position = [0,0,0], baseRotationY = 0 },
  ref
) {
  const { scene } = useGLTF(`${BASE}objs/${file}`)

  const sceneClone = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    const s = normalizeScale(scaleSetting)
    clone.scale.set(s.x, s.y, s.z)
    return clone
  }, [scene, scaleSetting])

  return (
    <group
      ref={ref}
      position={position}
      rotation={[0, baseRotationY, 0]}
      scale={[1, 1, 1]}
    >
      <primitive
        object={sceneClone}
        rotation={[0, THREE.MathUtils.degToRad(rotYdeg), 0]}
      />
    </group>
  )
})

/* ================= Sparkle Link (supports small size) ================= */
function SparkleLink({ href, children, label = 'Open link', size = 'md' }) {
  const count = 12
  const sizeClass = size === 'sm' ? 'sparkle-link--sm' : 'sparkle-link--md'
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className={`sparkle-link ${sizeClass}`}
      style={{ position: 'relative', zIndex: 1, textDecoration: 'none', cursor: 'pointer', userSelect: 'none' }}
    >
      <span className="sparkle-link__chip">
        {children}
        <span className="sparkle-link__shine" aria-hidden="true" />
        <span className="sparkle-link__sparkles" aria-hidden="true">
          {Array.from({ length: count }).map((_, i) => <span className="sparkle" key={i} />)}
        </span>
      </span>
    </a>
  )
}

/* ================ Compact list of links rendered from GAMES ================ */
function GameLinks({ games }) {
  return (
    <nav
      aria-label="Games"
      style={{
        position: 'fixed',
        top: 58, // sits below the main title
        left: 12,
        zIndex: 35,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'auto',
      }}
    >
      {games.map((g) => (
        <SparkleLink key={g.href} href={g.href} label={g.title} size="sm">
          🎮 {g.title}
        </SparkleLink>
      ))}
    </nav>
  )
}

/* ========================= App ========================= */
export default function App() {
  const audioRef = useRef(null)

  // Fallback defaults (no panel UI; preset locked to 'lobby')
  const defaults = useMemo(() => ({
    skyTop: '#87CEE8', skyTopAlpha: 1,
    skyBottom: '#FFFFFF', skyBottomAlpha: 1,
    groundColor: '#FFF8DC', groundAlpha: 1,
    sunColor: '#FFD580',
    fogType: 'linear',
    fogNear: 1,
    fogFar: 4000,
    fogDensity: 0.0025,
    gradientExponent: 0.9,
    envPreset: 'lobby',
    envIntensity: 0.8,
    ambientColor: '#FFF6DA',
    ambientIntensity: 0.25,
    hemiEnabled: true,
    hemiIntensity: 0.6,
    dirEnabled: true,
    dirIntensity: 1.3,
    sunAzimuth: 45,
    sunElevation: 55,
    rimEnabled: false,
    rimColor: '#ffffff',
    rimIntensity: 0.0,
    rimAzimuth: 220,
    rimElevation: 25,
  }), [])

  const [env, setEnv] = useState(() => ({ ...defaults }))

  // Optionally read lights-settings.txt but force preset to 'lobby'
  useEffect(() => {
    let cancelled = false
    fetch(`${BASE}lights-settings.txt`)
      .then(r => r.text())
      .then(t => {
        if (cancelled) return
        try {
          const parsed = JSON.parse(t)
          const validated = validateEnv(parsed, defaults)
          setEnv({ ...validated, envPreset: 'lobby' })
        } catch {
          setEnv({ ...defaults })
        }
      })
      .catch(() => setEnv({ ...defaults }))
    return () => { cancelled = true }
  }, [defaults])

  // Audio boot
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    a.loop = true; a.preload = 'auto'; a.playsInline = true
    const tryPlay = async () => { a.muted = false; a.volume = TARGET_VOL; await a.play() }
    const startMutedAutoplay = async () => {
      a.muted = false; a.volume = TARGET_VOL
      try { await a.play() } catch {}
      const unlock = () => {
        a.muted = false
        const start = performance.now()
        const fade = () => {
          const t = (performance.now() - start) / 500
          a.volume = Math.min(TARGET_VOL, t * TARGET_VOL)
          if (t < 1) requestAnimationFrame(fade)
        }
        requestAnimationFrame(fade)
        window.removeEventListener('pointerdown', unlock)
        window.removeEventListener('keydown', unlock)
        window.removeEventListener('touchstart', unlock)
      }
      window.addEventListener('pointerdown', unlock, { once: true })
      window.addEventListener('keydown', unlock, { once: true })
      window.addEventListener('touchstart', unlock, { once: true })
    }
    ;(async () => { try { await tryPlay() } catch { await startMutedAutoplay() } })()
  }, [])

  const wavePalette = useMemo(
    () => ["#FF5733","#FFC300","#DAF7A6","#33FF57","#33FFF3","#3380FF","#8E44AD",
           "#FF33B5","#FF8C33","#FF7F50","#00CED1","#7FFF00","#FFD700",
           "#BA55D3","#FF69B4","#40E0D0","#6495ED","#FFA07A","#ADFF2F","#20B2AA"],
    []
  )

  /* ===== Base models list with per-axis scale + yOffset ===== */
  const baseModelsSettings = useMemo(() => ([
    { file: 'rocket.glb',           scale: { x: 2.0, y: 2.0, z: 2.0 }, rotYdeg: 0, yOffset: -1.0 },
    { file: 'flowerblue.glb',       scale: { x: 1.0, y: 1.0, z: 1.0 }, rotYdeg: 0, yOffset: 0.0 },
    { file: 'basketball.glb',       scale: { x: 1.0, y: 1.0, z: 1.0 }, rotYdeg: 0, yOffset: 0.0 },
    { file: 'mushroomOrg.glb',      scale: { x: .80, y: .80, z: 0.80 }, rotYdeg: 0, yOffset: 0.0 },
    { file: 'icecreamCha.glb',      scale: { x: 1.0, y: 1.0, z: 1.0 }, rotYdeg: 0, yOffset: -1.6 },
    { file: 'watermelonYellow.glb', scale: { x: .80, y: .80, z: .80 }, rotYdeg: 0, yOffset: 0.0 },
    { file: 'sun.glb',              scale: 1.0,                               rotYdeg: 0, yOffset: 0.0 },
    { file: 'moon.glb',             scale: { x: 1.0, y: 1.0, z: 1.0 }, rotYdeg: 0, yOffset: 0.0 },
    { file: 'pencil.glb',           scale: { x: 0.5, y: 0.5, z: 0.5 }, rotYdeg: 0, yOffset: 0.0 },
    { file: 'icecream1.glb',        scale: { x: 1.0, y: 1.0, z: 1.0 }, rotYdeg: 0, yOffset: -1.6 },
    { file: 'flowerRed.glb',        scale: { x: 1.0, y: 1.0, z: 1.0 }, rotYdeg: 0, yOffset: 0.0 },
    { file: 'orange.glb',           scale: { x: 1.0, y: 1.0, z: 1.0 }, rotYdeg: 0, yOffset: 0.0 },
    { file: 'gem.glb',              scale: 1.0,                               rotYdeg: 0, yOffset: 0.0 },
    { file: 'icecreamblue.glb',     scale: { x: 1.0, y: 1.0, z: 1.0 }, rotYdeg: 0, yOffset: -1.6 },
    { file: 'Soccer.glb',           scale: 1.0,                               rotYdeg: 0, yOffset: 0.0 },
    { file: 'floweryellow.glb',     scale: { x: 1.0, y: 1.0, z: 1.0 }, rotYdeg: 0, yOffset: 0.0 },
    { file: 'watermelon.glb',       scale: { x: .80, y: .80, z: .80 }, rotYdeg: 0, yOffset: 0.0 },
    { file: 'mushroom1.glb',        scale: { x: .80, y: .80, z: 0.80 }, rotYdeg: 0, yOffset: 0.0 },
    { file: 'flower.glb',           scale: { x: 1.0, y: 1.0, z: 1.0 }, rotYdeg: 0, yOffset: 0.0 },
    { file: 'icecreampurple.glb',   scale: { x: 1.0, y: 1.0, z: 1.0 }, rotYdeg: 0, yOffset: -1.6 },
  ]), [])

  // Duplicate until COUNT is reached (keeps order)
  const modelsSettings = useMemo(() => {
    const result = []
    while (result.length < COUNT) result.push(...baseModelsSettings)
    return result.slice(0, COUNT)
  }, [baseModelsSettings])

  return (
    <>
      {/* --- Styles: sparkle chips + SINGLE-COLUMN title tooltip --- */}
      <style>{`
        .sparkle-link__chip{
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: .5rem;
          padding: 10px 14px;
          border-radius: 12px;
          font: 700 16px/1.1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          color: #fff;
          background: linear-gradient(135deg, rgba(0,0,0,.65), rgba(0,0,0,.35));
          box-shadow: 0 6px 18px rgba(0,0,0,.25);
          transition: transform .15s ease, box-shadow .2s ease, background .2s ease;
          backdrop-filter: blur(4px);
          white-space: nowrap;
        }
        .sparkle-link--sm .sparkle-link__chip{ padding: 8px 12px; font-size: 14px; }
        .sparkle-link:hover .sparkle-link__chip{
          transform: translateY(-1px);
          box-shadow: 0 10px 26px rgba(0,0,0,.28);
          background: linear-gradient(135deg, rgba(0,0,0,.75), rgba(0,0,0,.42));
        }
        .sparkle-link__shine{ position: absolute; inset: 0; border-radius: 12px; overflow: hidden; pointer-events: none; }
        .sparkle-link__shine::before{
          content:''; position: absolute; top: -50%; left: -30%; width: 40%; height: 200%;
          background: linear-gradient(115deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.25) 50%, rgba(255,255,255,0) 100%);
          transform: translateX(-120%) rotate(20deg);
          transition: transform .6s ease;
        }
        .sparkle-link:hover .sparkle-link__shine::before{ transform: translateX(260%) rotate(20deg); }
        .sparkle-link__sparkles{
          position: absolute; inset: -10px -14px; pointer-events: none; opacity: 0; transition: opacity .15s ease;
          filter: drop-shadow(0 0 6px rgba(255,255,255,.6));
        }
        .sparkle-link:hover .sparkle-link__sparkles{ opacity: 1; }
        .sparkle{
          position: absolute; width: 6px; height: 6px;
          background: radial-gradient(circle at 50% 50%, #fff 0%, #ffe17a 55%, rgba(255,255,255,0) 70%);
          border-radius: 50%; transform: translate3d(0,0,0) scale(0);
          animation: sparkle-pop .9s ease forwards; animation-delay: calc(var(--d, 0) * 1ms);
          opacity: .95; mix-blend-mode: screen;
        }
        @keyframes sparkle-pop{
          0% { transform: translate(var(--x,0), var(--y,0)) scale(0); opacity: 0; }
          40%{ transform: translate(var(--x,0), var(--y,0)) scale(1); opacity: 1; }
          100%{ transform: translate(calc(var(--x,0)*1.35), calc(var(--y,0)*1.35)) scale(0); opacity: 0; }
        }
        .sparkle:nth-child(1){--x:-6px; --y:-18px; --d:  0;}
        .sparkle:nth-child(2){--x:10px; --y:-14px; --d: 60;}
        .sparkle:nth-child(3){--x:-16px;--y: 8px;  --d:120;}
        .sparkle:nth-child(4){--x:14px; --y:10px;  --d:180;}
        .sparkle:nth-child(5){--x:32px; --y:-6px;  --d:240;}
        .sparkle:nth-child(6){--x:-30px;--y:-4px;  --d:300;}
        .sparkle:nth-child(7){--x:0px;  --y:18px;  --d:360;}
        .sparkle:nth-child(8){--x:-22px;--y:16px;  --d:420;}
        .sparkle:nth-child(9){--x:24px; --y:16px;  --d:480;}
        .sparkle:nth-child(10){--x:36px;--y:-14px; --d:540;}
        .sparkle:nth-child(11){--x:-38px;--y:-12px; --d:600;}
        .sparkle:nth-child(12){--x:8px; --y:-22px; --d:660;}

        /* ===== Title tooltip (SINGLE COLUMN, compact) ===== */
        .site-title{ position:fixed; inset:auto; }
        .site-title__bubble{
          position: absolute;
          left: 50%;
          top: calc(100% + 10px);
          transform: translateX(-50%) translateY(4px) scale(.98);

          width: clamp(320px, 58vw, 720px);
          max-width: 92vw;

          font-size: clamp(12px, 0.9vw + 9px, 14px);
          line-height: 1.28;

          padding: 12px 14px;
          border-radius: 12px;
          color: #fff;
          background: linear-gradient(180deg, #1e1f22, #111215);
          box-shadow: 0 10px 28px rgba(0,0,0,.22), 0 2px 6px rgba(0,0,0,.12);
          opacity: 0;
          pointer-events: none;
          transition: opacity .15s ease, transform .18s ease;
          z-index: 31;
          white-space: normal;
          text-align: left;

          /* force SINGLE column + nicer word handling */
          column-count: 1 !important;
          column-gap: 0 !important;
          hyphens: none;
          -webkit-hyphens: none;
          word-break: normal;

          /* show whole text by default */
          max-height: none;
          overflow: visible;
        }
        .site-title__bubble::before{
          content:'';
          position: absolute;
          top: -8px; left: 50%;
          transform: translateX(-50%);
          border: 8px solid transparent;
          border-bottom-color: #1e1f22;
          filter: drop-shadow(0 2px 3px rgba(0,0,0,.12));
        }
        .site-title:hover .site-title__bubble,
        .site-title:focus-within .site-title__bubble{
          opacity: 1;
          transform: translateX(-50%) translateY(0) scale(1);
        }
        @media (prefers-reduced-motion: reduce){
          .site-title__bubble{ transition: opacity .001s linear; }
        }
      `}</style>

      {/* --- Top-center title with single-block tooltip --- */}
      <div
        className="site-title"
        tabIndex={0}
        style={{
          position: 'fixed',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 30,
          padding: '8px 14px',
          borderRadius: 12,
          background: 'linear-gradient(135deg, rgba(0,0,0,.55), rgba(0,0,0,.25))',
          color: '#fff',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          fontWeight: 700,
          letterSpacing: 0.6,
          fontSize: 18,
          textShadow: '0 2px 8px rgba(0,0,0,.6)',
          boxShadow: '0 6px 18px rgba(0,0,0,.25)',
          pointerEvents: 'auto',
          userSelect: 'none',
        }}
        aria-describedby="siteTitleTooltip"
      >
        Healthy Games for Kids
        <span id="siteTitleTooltip" className="site-title__bubble" role="tooltip">
          Designed with kids’ well-being in mind: it promotes physical movement, balanced short play,
          and safe content without violence, harmful themes, virtual coins. It’s ad-free, virus-free,
          and fully open-source on GitHub — plus families can even create their own games from it.
        </span>
      </div>

      {/* --- List rendered from GAMES (Zombie included) --- */}
      <GameLinks games={GAMES} />

      {/* audio UI */}
      <audio
        ref={audioRef}
        src={`${BASE}childrenbackgroundmusic.mp3`}
        controls loop autoPlay playsInline
        style={{ position:'fixed', bottom:16, left:16, background:'rgba(255,255,255,0.9)', borderRadius:8, padding:4, zIndex:10 }}
      />

      <Canvas
        style={{ position:'fixed', inset:0, touchAction: 'none' }}
        camera={{ position:[0, CONTENT_Y + 0.8, 10], fov:60, near:0.1, far:5000 }}
        shadows
        gl={{ alpha: true }}
      >
        {/* preset locked to 'lobby' */}
        <Environment preset="lobby" background={false} intensity={parseFloat(env.envIntensity)} />

        <ExampleBackground
          skyTop={env.skyTop}
          skyTopAlpha={parseFloat(env.skyTopAlpha)}
          skyBottom={env.skyBottom}
          skyBottomAlpha={parseFloat(env.skyBottomAlpha)}
          groundColor={env.groundColor}
          groundAlpha={parseFloat(env.groundAlpha)}
          sunColor={env.sunColor}
          hemiEnabled={env.hemiEnabled}
          dirEnabled={env.dirEnabled}
          dirIntensity={parseFloat(env.dirIntensity)}
          hemiIntensity={parseFloat(env.hemiIntensity)}
          sunAzimuth={parseFloat(env.sunAzimuth)}
          sunElevation={parseFloat(env.sunElevation)}
          fogType={env.fogType}
          fogNear={parseFloat(env.fogNear)}
          fogFar={parseFloat(env.fogFar)}
          fogDensity={parseFloat(env.fogDensity)}
          gradientExponent={parseFloat(env.gradientExponent)}
        />

        <ambientLight color={env.ambientColor} intensity={parseFloat(env.ambientIntensity)} />

        <RimLight
          enabled={env.rimEnabled}
          color={env.rimColor}
          intensity={parseFloat(env.rimIntensity)}
          azimuth={220}
          elevation={25}
        />

        <OrbitControls
          makeDefault
          target={[0, CONTENT_Y, 0]}
          enablePan={false}
          enableZoom={false}
          enableRotate
          enableDamping
          dampingFactor={0.12}
          rotateSpeed={1.5}
          autoRotate
          autoRotateSpeed={0.6}
          minDistance={10}
          maxDistance={10}
          minPolarAngle={0.1}
          maxPolarAngle={Math.PI - 0.1}
          mouseButtons={{ LEFT: THREE.MOUSE.ROTATE }}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.ROTATE }}
        />

        <group position={[0, CONTENT_Y, 0]}>
          {/* Configurable models ring */}
          <Suspense fallback={null}>
            <ConfigurableModelsRing audioRef={audioRef} modelsSettings={modelsSettings} />
          </Suspense>

          {/* Waves (toggle with SHOW_WAVES) */}
          {SHOW_WAVES && (
            Array.from({ length: 10 }).map((_, i) => (
              <SineCircle
                key={i}
                radius={24}
                segments={300}
                speed={0.6}
                amplitude={2}
                phase={(i / 30) * Math.PI * 2}
                color={wavePalette[i % wavePalette.length]}
                thickness={0.1}
              />
            ))
          )}
        </group>

        <ContactShadows
          position={[0, 0, 0]}
          opacity={0.4}
          width={120}
          height={120}
          blur={1.6}
          far={40}
        />
      </Canvas>
    </>
  )
}
