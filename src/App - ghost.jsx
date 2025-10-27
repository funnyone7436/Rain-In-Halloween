// src/App.jsx
import React, { useMemo, useRef, useEffect, useState, Suspense } from 'react'
import * as THREE from 'three'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, useTexture } from '@react-three/drei'
import { Leva, useControls } from 'leva'

/* Base path (works locally & on GitHub Pages) */
const BASE = import.meta.env.BASE_URL || '/'

/* -------------------- Helpers -------------------- */
const ringPositions = (count, radius) => {
  const pts = []
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    pts.push([Math.cos(a) * radius, 0, Math.sin(a) * radius])
  }
  return pts
}
const hex = (c) => new THREE.Color(c)
const lerpColor = (a, b, t) => hex(a).lerp(hex(b), t).getStyle()

/* -------------------- Sky (shader) -------------------- */
function GradientSky({ top='#6c4ab6', mid='#7e59c6', bottom='#b592ff', exponent=1.2 }) {
  const { scene } = useThree()
  const uniforms = useMemo(() => ({
    top:    { value: hex(top) },
    mid:    { value: hex(mid) },
    bottom: { value: hex(bottom) },
    exponent: { value: exponent },
  }), [top, mid, bottom, exponent])

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 top, mid, bottom;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, 200.0, 0.0)).y;
        float t = pow(smoothstep(0.0, 1.0, h*0.5+0.5), exponent);
        vec3 c = mix(bottom, mix(mid, top, t), t);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
  }), [uniforms])

  useEffect(() => { scene.background = null }, [scene])

  return (
    <mesh>
      <sphereGeometry args={[3000, 32, 16]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}

/* -------------------- Mountains -------------------- */
function Hill({ color='#1a1026', radius=3, height=1, width=1.8, position=[0,0,0] }) {
  return (
    <group position={position} scale={[width, height, width]}>
      <mesh>
        <sphereGeometry args={[radius, 32, 16, 0, Math.PI*2, 0, Math.PI/2]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  )
}

function HillRing({
  count=24,
  radius=40,
  y=-1.2,
  color='#120a1b',
  minR=3,
  maxR=7,
  minH=0.6,
  maxH=1.2,
  width=1.8,
  jitter=2.5
}) {
  const positions = useMemo(() => {
    const base = ringPositions(count, radius)
    return base.map(([x, , z]) => [x + (Math.random()-0.5)*jitter, y, z + (Math.random()-0.5)*jitter])
  }, [count, radius, y, jitter])

  return (
    <>
      {positions.map((p, i) => {
        const r = THREE.MathUtils.lerp(minR, maxR, Math.random())
        const h = THREE.MathUtils.lerp(minH, maxH, Math.random())
        const w = width * (0.85 + Math.random()*0.3)
        return <Hill key={i} color={color} radius={r} height={h} width={w} position={p} />
      })}
    </>
  )
}

function Mountains({
  ringCount,
  hillsPerRing,
  baseRadius,
  ringSpacing,
  nearColor,
  farColor,
  yBase,
  fogDensity
}) {
  const { scene } = useThree()
  useEffect(() => {
    scene.fog = new THREE.FogExp2(new THREE.Color('#0e0818'), fogDensity)
    return () => { scene.fog = null }
  }, [scene, fogDensity])

  const rings = useMemo(() => (
    Array.from({ length: ringCount }, (_, i) => {
      const t = (i + 1) / ringCount
      const color = lerpColor(farColor, nearColor, t)
      return { radius: baseRadius + i * ringSpacing, color, count: hillsPerRing + i * 2, y: yBase + i * 0.05, i }
    })
  ), [ringCount, hillsPerRing, baseRadius, ringSpacing, nearColor, farColor, yBase])

  return (
    <>
      {rings.map((r) => (
        <HillRing
          key={r.i}
          count={r.count}
          radius={r.radius}
          color={r.color}
          y={r.y}
          minR={3 + r.i * 0.4}
          maxR={7 + r.i * 0.6}
          minH={0.6}
          maxH={1.25}
          width={1.8}
          jitter={3.2}
        />
      ))}
    </>
  )
}

/* -------------------- Roller Coaster -------------------- */
function useCoasterCurve({ radius, turns, ampY, ampR, freqY, freqR, segments }) {
  return useMemo(() => {
    const pts = []
    for (let i = 0; i < segments; i++) {
      const u = i / segments
      const a = u * Math.PI * 2 * turns
      const r = radius + ampR * Math.sin(a * freqR)
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      const y = ampY * Math.sin(a * freqY + Math.PI * 0.25)
      pts.push(new THREE.Vector3(x, y, z))
    }
    return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5)
  }, [radius, turns, ampY, ampR, freqY, freqR, segments])
}

function CoasterTrack({
  radius = 22,
  turns = 1,
  ampY = 2.2,
  ampR = 1.2,
  freqY = 3,
  freqR = 2,
  railGap = 0.7,
  tubeRadius = 0.05,
  segments = 800,
  railColor = '#e6d2a3',
}) {
  const center = useCoasterCurve({ radius, turns, ampY, ampR, freqY, freqR, segments })
  const frames = useMemo(() => center.computeFrenetFrames(segments, true), [center, segments])

  const { leftCurve, rightCurve } = useMemo(() => {
    const leftPts = [], rightPts = []
    for (let i = 0; i <= segments; i++) {
      const u = i / segments
      const p = center.getPointAt(u)
      const n = frames.normals[i % frames.normals.length]
      const off = n.clone().multiplyScalar(railGap * 0.5)
      leftPts.push(p.clone().add(off))
      rightPts.push(p.clone().sub(off))
    }
    return {
      leftCurve: new THREE.CatmullRomCurve3(leftPts, true),
      rightCurve: new THREE.CatmullRomCurve3(rightPts, true)
    }
  }, [center, frames, railGap, segments])

  return (
    <group>
      <mesh>
        <tubeGeometry args={[leftCurve, segments, tubeRadius, 8, true]} />
        <meshBasicMaterial color={railColor} fog={false} toneMapped={false} />
      </mesh>
      <mesh>
        <tubeGeometry args={[rightCurve, segments, tubeRadius, 8, true]} />
        <meshBasicMaterial color={railColor} fog={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

/* --- Billboard car that always faces the camera (ghost.png) --- */
function CoasterSpriteCar({
  curve,
  frames,
  textureUrl = `${BASE}ghost.png`,
  size = [2.5, 2.5],     // [width, height] in world units
  speed = 0.06,
  startU = 0,
  yOffset=1 
}) {
  const sprite = useRef()
  const uRef = useRef(startU)
  const map = useTexture(textureUrl)
  // make sure colors look correct
  useMemo(() => {
    if (map) {
      if ('colorSpace' in map) map.colorSpace = THREE.SRGBColorSpace
      else if ('encoding' in map) map.encoding = THREE.sRGBEncoding
    }
  }, [map])

  useFrame((_, dt) => {
    uRef.current = (uRef.current + speed * dt) % 1
    const u = uRef.current
    const p = curve.getPointAt(u)
    // Sprite always faces camera automatically; we only update position
	if (sprite.current) {
	  sprite.current.position.set(p.x, p.y + yOffset, p.z)
	}
  })

  return (
    <sprite ref={sprite} scale={[size[0], size[1], 1]}>
      <spriteMaterial
        map={map}
        transparent
        depthWrite={false}
        fog={false}
        toneMapped={false}
      />
    </sprite>
  )
}

function RollerCoaster({
  show=true,
  radius=22, turns=1, ampY=2.2, ampR=1.2, freqY=3, freqR=2,
  railGap=0.7, tubeRadius=0.05, segments=800,
  railColor='#e6d2a3',
  // car props now: sprite size and speed
  carSize=[0.9, 0.9], carSpeed=0.06, cars=1
}) {
  const centerCurve = useCoasterCurve({ radius, turns, ampY, ampR, freqY, freqR, segments })
  const frames = useMemo(() => centerCurve.computeFrenetFrames(segments, true), [centerCurve, segments])

  if (!show) return null
  return (
    <group>
      <CoasterTrack
        radius={radius}
        turns={turns}
        ampY={ampY}
        ampR={ampR}
        freqY={freqY}
        freqR={freqR}
        railGap={railGap}
        tubeRadius={tubeRadius}
        segments={segments}
        railColor={railColor}
      />
      {Array.from({ length: Math.max(1, cars) }).map((_, i) => (
        <CoasterSpriteCar
          key={i}
          curve={centerCurve}
          frames={frames}
          size={carSize}
          speed={carSpeed}
          startU={i / Math.max(1, cars)}
        />
      ))}
    </group>
  )
}

/* -------------------- Leva panels -------------------- */
function SkyPanel({ sky, setSky, autoRotate, setAutoRotate, panelKey }) {
  useControls(`Sky ${panelKey}`, {
    top:      { value: sky.top, onChange: v => setSky(s => ({ ...s, top: v })) },
    mid:      { value: sky.mid, onChange: v => setSky(s => ({ ...s, mid: v })) },
    bottom:   { value: sky.bottom, onChange: v => setSky(s => ({ ...s, bottom: v })) },
    exponent: { value: sky.exponent, min: .6, max: 2.5, step: .05, onChange: v => setSky(s => ({ ...s, exponent: v })) },
    autoRotate: { value: autoRotate, onChange: v => setAutoRotate(v) }
  })
  return null
}

function EnvPanel({ env, setEnv, panelKey }) {
  useControls(`Environment ${panelKey}`, {
    nearColor: { value: env.nearColor, onChange: v => setEnv(s => ({ ...s, nearColor: v })) },
    farColor:  { value: env.farColor,  onChange: v => setEnv(s => ({ ...s, farColor: v })) },
    ringCount: { value: env.ringCount, min: 1, max: 6, step: 1, onChange: v => setEnv(s => ({ ...s, ringCount: v })) },
    hillsPerRing: { value: env.hillsPerRing, min: 8, max: 80, step: 1, onChange: v => setEnv(s => ({ ...s, hillsPerRing: v })) },
    baseRadius: { value: env.baseRadius, min: 20, max: 120, step: 1, onChange: v => setEnv(s => ({ ...s, baseRadius: v })) },
    ringSpacing: { value: env.ringSpacing, min: 8, max: 40, step: 1, onChange: v => setEnv(s => ({ ...s, ringSpacing: v })) },
    yBase: { value: env.yBase, min: -6, max: 2, step: 0.1, onChange: v => setEnv(s => ({ ...s, yBase: v })) },
    fogDensity: { value: env.fogDensity, min: 0, max: 0.04, step: 0.001, onChange: v => setEnv(s => ({ ...s, fogDensity: v })) }
  })
  return null
}

function CoasterPanel({ coaster, setCoaster, panelKey }) {
  useControls(`Coaster ${panelKey}`, {
    show:     { value: coaster.show, onChange: v => setCoaster(s => ({ ...s, show: v })) },
    radius:   { value: coaster.radius, min: 10, max: 60, step: 0.1, onChange: v => setCoaster(s => ({ ...s, radius: v })) },
    turns:    { value: coaster.turns, min: 1, max: 3, step: 1, onChange: v => setCoaster(s => ({ ...s, turns: v })) },
    ampY:     { value: coaster.ampY, min: 0, max: 6, step: 0.05, onChange: v => setCoaster(s => ({ ...s, ampY: v })) },
    ampR:     { value: coaster.ampR, min: 0, max: 4, step: 0.05, onChange: v => setCoaster(s => ({ ...s, ampR: v })) },
    freqY:    { value: coaster.freqY, min: 1, max: 8, step: 1, onChange: v => setCoaster(s => ({ ...s, freqY: v })) },
    freqR:    { value: coaster.freqR, min: 1, max: 8, step: 1, onChange: v => setCoaster(s => ({ ...s, freqR: v })) },
    railGap:  { value: coaster.railGap, min: 0.4, max: 1.2, step: 0.01, onChange: v => setCoaster(s => ({ ...s, railGap: v })) },
    tubeRadius: { value: coaster.tubeRadius, min: 0.02, max: 0.12, step: 0.005, onChange: v => setCoaster(s => ({ ...s, tubeRadius: v })) },
    carSpeed: { value: coaster.carSpeed, min: 0.01, max: 0.2, step: 0.005, onChange: v => setCoaster(s => ({ ...s, carSpeed: v })) },
    cars:     { value: coaster.cars, min: 1, max: 10, step: 1, onChange: v => setCoaster(s => ({ ...s, cars: v })) },
    railColor:{ value: coaster.railColor, onChange: v => setCoaster(s => ({ ...s, railColor: v })) },
    carWidth: { value: coaster.carSize?.[0] ?? 0.9, min: 0.3, max: 2.5, step: 0.05, onChange: v => setCoaster(s => ({ ...s, carSize: [v, (s.carSize?.[1] ?? 0.9)] })) },
    carHeight:{ value: coaster.carSize?.[1] ?? 0.9, min: 0.3, max: 2.5, step: 0.05, onChange: v => setCoaster(s => ({ ...s, carSize: [(s.carSize?.[0] ?? 0.9), v] })) },
  })
  return null
}

/* -------------------- Main App (with Save/Load) -------------------- */
export default function App() {
  const defaultSky = { top: '#6c4ab6', mid: '#7b57c4', bottom: '#a07be6', exponent: 1.25 }
  const defaultEnv = {
    nearColor: '#110a1e',
    farColor:  '#1d1230',
    ringCount: 3,
    hillsPerRing: 28,
    baseRadius: 40,
    ringSpacing: 14,
    yBase: -1.6,
    fogDensity: 0.01
  }
  const defaultCoaster = {
    show: true,
    radius: 22, turns: 1,
    ampY: 2.2, ampR: 1.2,
    freqY: 3,  freqR: 2,
    railGap: 0.7, tubeRadius: 0.05,
    railColor: '#e6d2a3',
    carSize: [0.9, 0.9], carSpeed: 0.06, cars: 1
  }

  const [sky, setSky] = useState(defaultSky)
  const [env, setEnv] = useState(defaultEnv)
  const [coaster, setCoaster] = useState(defaultCoaster)
  const [autoRotate, setAutoRotate] = useState(true)

  // Keys to force Leva/panels to remount when loading settings
  const [uiKey, setUiKey] = useState(0)
  const [panelKey, setPanelKey] = useState(0)

  // Save / Load
  const fileRef = useRef(null)
  function saveToTxt() {
    const settings = { sky, env, coaster, orbit: { autoRotate } }
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'purple-mountains-settings.txt'
    document.body.appendChild(a)
    a.click()
    URL.revokeObjectURL(a.href)
    a.remove()
  }
  function requestLoad() { fileRef.current?.click() }
  async function onPickFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (parsed.sky) setSky(s => ({ ...s, ...parsed.sky }))
      if (parsed.env) setEnv(s => ({ ...s, ...parsed.env }))
      if (parsed.coaster) setCoaster(s => ({ ...s, ...parsed.coaster }))
      if (parsed.orbit && typeof parsed.orbit.autoRotate === 'boolean') setAutoRotate(parsed.orbit.autoRotate)
      setPanelKey(k => k + 1)   // refresh folders/controls
      setUiKey(k => k + 1)      // remount Leva to drop cached values
    } catch (err) {
      console.error('Load failed:', err)
      alert('Could not read file (must be valid JSON inside .txt or .json).')
    } finally {
      e.target.value = ''
    }
  }

  return (
    <>
      <Leva key={uiKey} collapsed={false} />
      <div style={{
        position: 'fixed', right: 12, bottom: 12, zIndex: 50,
        display: 'flex', gap: 8, padding: 8,
        background: 'rgba(0,0,0,.35)', borderRadius: 10, backdropFilter: 'blur(6px)',
        boxShadow: '0 6px 18px rgba(0,0,0,.25)'
      }}>
        <button onClick={saveToTxt} style={btn}>💾 Save</button>
        <button onClick={requestLoad} style={btn}>📂 Load</button>
        <input ref={fileRef} type="file" accept=".txt,.json" onChange={onPickFile} style={{ display: 'none' }} />
      </div>

      <SkyPanel key={`sky-${panelKey}`} panelKey={panelKey}
        sky={sky} setSky={setSky}
        autoRotate={autoRotate} setAutoRotate={setAutoRotate} />
      <EnvPanel key={`env-${panelKey}`} panelKey={panelKey} env={env} setEnv={setEnv} />
      <CoasterPanel key={`coaster-${panelKey}`} panelKey={panelKey} coaster={coaster} setCoaster={setCoaster} />

      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 2, 0], fov: 60, near: 0.1, far: 4000 }}
        gl={{ antialias: true, alpha: false }}
      >
        <ambientLight intensity={0.2} />
        <Suspense fallback={null}>
          <GradientSky top={sky.top} mid={sky.mid} bottom={sky.bottom} exponent={sky.exponent} />
          <Mountains
            ringCount={env.ringCount}
            hillsPerRing={env.hillsPerRing}
            baseRadius={env.baseRadius}
            ringSpacing={env.ringSpacing}
            nearColor={env.nearColor}
            farColor={env.farColor}
            yBase={env.yBase}
            fogDensity={env.fogDensity}
          />
          <RollerCoaster
            show={coaster.show}
            radius={coaster.radius}
            turns={coaster.turns}
            ampY={coaster.ampY}
            ampR={coaster.ampR}
            freqY={coaster.freqY}
            freqR={coaster.freqR}
            railGap={coaster.railGap}
            tubeRadius={coaster.tubeRadius}
            segments={800}
            railColor={coaster.railColor}
            carSize={coaster.carSize}
            carSpeed={coaster.carSpeed}
            cars={coaster.cars}
          />
        </Suspense>

        <OrbitControls
          enableZoom={false}
          enablePan={false}
          enableDamping
          dampingFactor={0.1}
          autoRotate={autoRotate}
          autoRotateSpeed={0.25}
          target={[0, 1.2, 0]}
        />
      </Canvas>
    </>
  )
}

/* -------------------- UI styles -------------------- */
const btn = {
  appearance: 'none',
  border: 'none',
  color: '#fff',
  fontWeight: 700,
  padding: '8px 12px',
  borderRadius: 8,
  cursor: 'pointer',
  background: 'linear-gradient(135deg, #3a3f52, #2b2f3d)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 6px 16px rgba(0,0,0,.25)'
}
