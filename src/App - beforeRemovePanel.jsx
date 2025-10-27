// src/App.jsx
import React, { useMemo, useRef, useEffect, useState, Suspense } from 'react'
import * as THREE from 'three'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, useTexture, Billboard } from '@react-three/drei'
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

/* -------------------- Roller Coaster core -------------------- */
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

/* --- Arc-length LUT --- */
function buildArcLengthLUT(curve, samples = 2000) {
  const u = new Float32Array(samples + 1)
  const s = new Float32Array(samples + 1)
  let acc = 0
  let prev = curve.getPointAt(0)
  u[0] = 0; s[0] = 0
  for (let i = 1; i <= samples; i++) {
    const t = i / samples
    const p = curve.getPointAt(t)
    acc += p.distanceTo(prev)
    u[i] = t; s[i] = acc
    prev = p
  }
  return { u, s, L: acc }
}
function uFromS(lut, sVal) {
  const { u, s, L } = lut
  let x = sVal % L
  if (x < 0) x += L
  let lo = 0, hi = s.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (s[mid] <= x) lo = mid
    else hi = mid
  }
  const t = (x - s[lo]) / ((s[hi] - s[lo]) || 1)
  return THREE.MathUtils.lerp(u[lo], u[hi], t)
}

/* --- Rails --- */
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

/* --- Ghost car with gravity (reactive yOffset & size) --- */
function CoasterSpriteCar({
  curve,
  frames,
  lut,
  textureUrl = `${BASE}ghost.png`,
  size = [2.5, 2.5],
  g = 3.5,
  drag = 0.02,
  uSpeed = 0.2,
  minV = 1,
  maxV = 12,
  startU = 0,
  yOffset = 1,
  useTrackNormal = false,
  speedScale = 1
}) {
  const sprite = useRef()
  const map = useTexture(textureUrl)

  useMemo(() => {
    if (map) {
      if ('colorSpace' in map) map.colorSpace = THREE.SRGBColorSpace
      else if ('encoding' in map) map.encoding = THREE.sRGBEncoding
    }
  }, [map])

  const sRef = useRef(0)
  const vRef = useRef(0)
  const yOffRef = useRef(yOffset)
  useEffect(() => { yOffRef.current = yOffset }, [yOffset])
  useEffect(() => { if (sprite.current) sprite.current.scale.set(size[0], size[1], 1) }, [size])

  useEffect(() => {
    if (!lut) return
    sRef.current = (startU % 1) * lut.L
    vRef.current = THREE.MathUtils.clamp(uSpeed * lut.L, minV, maxV)
  }, [lut, startU, uSpeed, minV, maxV])

  useFrame((_, dtRaw) => {
    if (!lut) return
    const dtClamped = Math.min(dtRaw, 0.05)
    let remaining = dtClamped * speedScale
    let v = vRef.current
    let s = sRef.current
    const maxStep = 1 / 120
    while (remaining > 0) {
      const step = Math.min(remaining, maxStep)
      const u0 = uFromS(lut, s)
      const t0 = curve.getTangentAt(u0).normalize()
      const a  = -g * t0.y - drag * v
      v = THREE.MathUtils.clamp(v + a * step, minV, maxV)
      s = (s + v * step) % lut.L
      remaining -= step
    }
    vRef.current = v
    sRef.current = s
    const u = uFromS(lut, s)
    const p = curve.getPointAt(u)
    if (!sprite.current) return
    if (useTrackNormal && frames) {
      const idx = Math.floor(u * frames.normals.length) % frames.normals.length
      const n = frames.normals[idx]
      sprite.current.position.copy(p).addScaledVector(n, yOffRef.current)
    } else {
      sprite.current.position.set(p.x, p.y + yOffRef.current, p.z)
    }
  })

  return (
    <sprite ref={sprite}>
      <spriteMaterial map={map} transparent depthWrite={false} fog={false} toneMapped={false} />
    </sprite>
  )
}

function RollerCoaster({
  show=true,
  radius=22, turns=1, ampY=2.2, ampR=1.2, freqY=3, freqR=2,
  railGap=0.7, tubeRadius=0.05, segments=800,
  railColor='#e6d2a3',
  carSize=[0.9, 0.9], carSpeed=0.06, cars=1,
  yOffset=1, useTrackNormal=false,
  speedScale=1
}) {
  const centerCurve = useCoasterCurve({ radius, turns, ampY, ampR, freqY, freqR, segments })
  const frames = useMemo(() => centerCurve.computeFrenetFrames(segments, true), [centerCurve, segments])
  const lut = useMemo(() => buildArcLengthLUT(centerCurve, Math.max(1200, segments * 2)), [centerCurve, segments])

  if (!show) return null
  return (
    <group>
      <CoasterTrack
        radius={radius} turns={turns}
        ampY={ampY} ampR={ampR} freqY={freqY} freqR={freqR}
        railGap={railGap} tubeRadius={tubeRadius}
        segments={segments} railColor={railColor}
      />
      {Array.from({ length: Math.max(1, cars) }).map((_, i) => (
        <CoasterSpriteCar
          key={i}
          curve={centerCurve}
          frames={frames}
          lut={lut}
          size={carSize}
          uSpeed={carSpeed}
          startU={i / Math.max(1, cars)}
          yOffset={yOffset}
          useTrackNormal={useTrackNormal}
          speedScale={speedScale}
        />
      ))}
    </group>
  )
}

/* -------------------- Rain (fast line-segment rain) -------------------- */
function Rain({
  enabled = true,
  count = 1500,
  areaRadius = 60,
  areaHeight = 40,
  groundY = -1.6,
  speed = 26,
  length = 1.2,
  windX = 1.8,
  windZ = -0.6,
  color = '#a9c8ff',
  opacity = 0.75
}) {
  const geoRef = useRef()
  const lineMat = useMemo(
    () => new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true
    }),
    [color, opacity]
  )

  const state = useMemo(() => {
    const p = new Float32Array(count * 3)
    const v = new Float32Array(count * 3)
    const rndInDisc = () => {
      const t = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * areaRadius
      return [Math.cos(t) * r, Math.sin(t) * r]
    }
    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      const [rx, rz] = rndInDisc()
      p[i3+0] = rx
      p[i3+1] = groundY + Math.random() * areaHeight
      p[i3+2] = rz

      const vy = -(speed * (0.7 + Math.random() * 0.6))
      v[i3+0] = windX * (0.6 + Math.random() * 0.8)
      v[i3+1] = vy
      v[i3+2] = windZ * (0.6 + Math.random() * 0.8)
    }
    return { p, v }
  }, [count, areaRadius, areaHeight, groundY, speed, windX, windZ])

  const positions = useMemo(() => new Float32Array(count * 2 * 3), [count])

  useEffect(() => {
    if (!geoRef.current) return
    const geo = geoRef.current
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.computeBoundingSphere()
  }, [positions])

  useFrame((_, dtRaw) => {
    if (!enabled || !geoRef.current) return
    const dt = Math.min(dtRaw, 0.05)
    const { p, v } = state
    const posAttr = geoRef.current.getAttribute('position')
    const arr = posAttr.array

    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      const i6 = i * 6

      // integrate
      p[i3+0] += v[i3+0] * dt
      p[i3+1] += v[i3+1] * dt
      p[i3+2] += v[i3+2] * dt

      // reset when below ground
      if (p[i3+1] < groundY) {
        const t = Math.random() * Math.PI * 2
        const r = Math.sqrt(Math.random()) * areaRadius
        p[i3+0] = Math.cos(t) * r
        p[i3+1] = groundY + areaHeight
        p[i3+2] = Math.sin(t) * r
      }

      // head
      const hx = p[i3+0], hy = p[i3+1], hz = p[i3+2]
      arr[i6+0] = hx
      arr[i6+1] = hy
      arr[i6+2] = hz

      // tail (opposite of velocity, scaled by `length`)
      const vx = v[i3+0], vy = v[i3+1], vz = v[i3+2]
      const mag = Math.max(0.0001, Math.hypot(vx, vy, vz))
      const k = length / mag

      arr[i6+3] = hx - vx * k
      arr[i6+4] = hy - vy * k
      arr[i6+5] = hz - vz * k
    }

    posAttr.needsUpdate = true
    geoRef.current.computeBoundingSphere()
  })

  if (!enabled) return null
  return (
    <lineSegments frustumCulled={false} renderOrder={998}>
      <bufferGeometry ref={geoRef} />
      <primitive object={lineMat} attach="material" />
    </lineSegments>
  )
}

/* -------------------- Image Ring (per-item overrides via 'items') -------------------- */
function ImageRing({
  enabled = true,
  images = [],
  radius = 12,
  y = 1.2,                  // default Y if per-item not set
  size = 2.2,               // default size if per-item not set
  items = null,             // [{ size, y }, ...] aligned to images
  mode = 'sprite',          // 'sprite' | 'billboard'
  opacity = 1
}) {
  const count = images.length
  const maps = useTexture(images)

  useMemo(() => {
    const arr = Array.isArray(maps) ? maps : [maps]
    for (const m of arr) {
      if (!m) continue
      if ('colorSpace' in m) m.colorSpace = THREE.SRGBColorSpace
      else if ('encoding' in m) m.encoding = THREE.sRGBEncoding
      m.needsUpdate = true
    }
  }, [maps])

  const positions = useMemo(() => ringPositions(count, radius), [count, radius])
  if (!enabled || !count) return null

  return (
    <group>
      {positions.map(([x, , z], i) => {
        const map = Array.isArray(maps) ? maps[i] : maps
        if (!map) return null
        const s = items?.[i]?.size ?? size
        const yi = items?.[i]?.y ?? y
        if (mode === 'sprite') {
          return (
            <sprite key={i} position={[x, yi, z]} scale={[s, s, 1]}>
              <spriteMaterial
                map={map}
                transparent
                opacity={opacity}
                depthWrite={false}
                fog={false}
                toneMapped={false}
              />
            </sprite>
          )
        }
        return (
          <Billboard key={i} position={[x, yi, z]} follow lockZ={false}>
            <mesh>
              <planeGeometry args={[s, s]} />
              <meshBasicMaterial
                map={map}
                transparent
                opacity={opacity}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          </Billboard>
        )
      })}
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
    carSpeed: { value: coaster.carSpeed, min: 0.005, max: 0.2, step: 0.005, onChange: v => setCoaster(s => ({ ...s, carSpeed: v })) },
    speedScale: { value: coaster.speedScale ?? 1, min: 1, max: 50, step: 0.05, onChange: v => setCoaster(s => ({ ...s, speedScale: v })) },
    cars:     { value: coaster.cars, min: 1, max: 10, step: 1, onChange: v => setCoaster(s => ({ ...s, cars: v })) },
    railColor:{ value: coaster.railColor, onChange: v => setCoaster(s => ({ ...s, railColor: v })) },
    carWidth: { value: coaster.carSize?.[0] ?? 0.9, min: 0.3, max: 2.5, step: 0.05, onChange: v => setCoaster(s => ({ ...s, carSize: [v, (s.carSize?.[1] ?? 0.9)] })) },
    carHeight:{ value: coaster.carSize?.[1] ?? 0.9, min: 0.3, max: 2.5, step: 0.05, onChange: v => setCoaster(s => ({ ...s, carSize: [(s.carSize?.[0] ?? 0.9), v] })) },
    yOffset:  { value: coaster.yOffset ?? 1, min: -2, max: 4, step: 0.05, onChange: v => setCoaster(s => ({ ...s, yOffset: v })) },
    useTrackNormal: { value: coaster.useTrackNormal ?? false, onChange: v => setCoaster(s => ({ ...s, useTrackNormal: v })) },
  })
  return null
}

/* -------------------- Rain Leva panel -------------------- */
function RainPanel({ rain, setRain, panelKey }) {
  useControls(`Rain ${panelKey}`, {
    enabled:  { value: rain.enabled, onChange: v => setRain(s => ({ ...s, enabled: v })) },
    rate:     { label: 'drops', value: rain.count, min: 0, max: 8000, step: 100,
                onChange: v => setRain(s => ({ ...s, count: Math.round(v) })) },
    speed:    { value: rain.speed, min: 5, max: 80, step: 1,
                onChange: v => setRain(s => ({ ...s, speed: v })) },
    length:   { value: rain.length, min: 0.2, max: 3.0, step: 0.05,
                onChange: v => setRain(s => ({ ...s, length: v })) },
    radius:   { value: rain.areaRadius, min: 10, max: 120, step: 1,
                onChange: v => setRain(s => ({ ...s, areaRadius: v })) },
    height:   { value: rain.areaHeight, min: 10, max: 120, step: 1,
                onChange: v => setRain(s => ({ ...s, areaHeight: v })) },
    windX:    { value: rain.windX, min: -10, max: 10, step: 0.1,
                onChange: v => setRain(s => ({ ...s, windX: v })) },
    windZ:    { value: rain.windZ, min: -10, max: 10, step: 0.1,
                onChange: v => setRain(s => ({ ...s, windZ: v })) },
    opacity:  { value: rain.opacity, min: 0.1, max: 1.0, step: 0.05,
                onChange: v => setRain(s => ({ ...s, opacity: v })) },
    color:    { value: rain.color ?? '#a9c8ff',
                onChange: v => setRain(s => ({ ...s, color: v })) },
  })
  return null
}

/* -------------------- Image Ring Leva panel (global defaults) -------------------- */
function ImageRingPanel({ imgRing, setImgRing, panelKey }) {
  useControls(`Image Ring ${panelKey}`, {
    enabled: { value: imgRing.enabled, onChange: v => setImgRing(s => ({ ...s, enabled: v })) },
    radius:  { value: imgRing.radius, min: 2, max: 120, step: 0.1, onChange: v => setImgRing(s => ({ ...s, radius: v })) },
    y:       { value: imgRing.y, min: -4, max: 60, step: 0.05, onChange: v => setImgRing(s => ({ ...s, y: v })) },
    size:    { value: imgRing.size, min: 0.1, max: 32, step: 0.05, onChange: v => setImgRing(s => ({ ...s, size: v })) },
    mode:    { value: imgRing.mode, options: ['sprite', 'billboard'], onChange: v => setImgRing(s => ({ ...s, mode: v })) },
    opacity: { value: imgRing.opacity, min: 0.1, max: 1.0, step: 0.05, onChange: v => setImgRing(s => ({ ...s, opacity: v })) },
  })
  return null
}

/* -------------------- Main App -------------------- */
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
    carSize: [0.9, 0.9], carSpeed: 0.06, cars: 1,
    yOffset: 1, useTrackNormal: false,
    speedScale: 1
  }
  const defaultRain = {
    enabled: true,
    count: 1500,
    areaRadius: 60,
    areaHeight: 40,
    speed: 26,
    length: 1.2,
    windX: 1.8,
    windZ: -0.6,
    opacity: 0.75,
    color: '#a9c8ff'
  }
  const defaultImgRing = {
    enabled: true,
    radius: 12,
    y: 1.2,
    size: 2.2,
    mode: 'sprite',
    opacity: 1
  }

  const [sky, setSky] = useState(defaultSky)
  const [env, setEnv] = useState(defaultEnv)
  const [coaster, setCoaster] = useState(defaultCoaster)
  const [rain, setRain] = useState(defaultRain)
  const [imgRing, setImgRing] = useState(defaultImgRing)
  const [autoRotate, setAutoRotate] = useState(true)

  // === Number 2 solution: single list that controls each image's size & heightY ===
  const portraitList = [
    { src: `${BASE}img/C1.png`, size: 36, y: 18 },
    { src: `${BASE}img/s1.png`, size: 20, y: 8 },
    { src: `${BASE}img/T5.png`, size: 16, y: 8 },
    { src: `${BASE}img/T6.png`, size: 16, y: 8 },
    { src: `${BASE}img/T20.png`, size: 10, y: 8 },
    { src: `${BASE}img/C2.png`, size: 38, y: 12 },
    { src: `${BASE}img/s2.png`, size: 20, y: 6 },
    { src: `${BASE}img/T18.png`, size: 18, y: 6 },
    { src: `${BASE}img/T7.png`, size: 16, y: 6 },
    { src: `${BASE}img/T8.png`, size: 16, y: 6 },
    { src: `${BASE}img/C3.png`, size: 32, y: 12 },
    { src: `${BASE}img/T16.png`, size: 16, y: 6 },
    { src: `${BASE}img/T1.png`, size: 20, y: 6 },
    { src: `${BASE}img/T9.png`, size: 16, y: 6 },
    { src: `${BASE}img/C4.png`, size: 36, y: 12 },
    { src: `${BASE}img/T11.png`, size: 16, y: 8 },
    { src: `${BASE}img/T2.png`, size: 20, y: 8 },
    { src: `${BASE}img/T12.png`, size: 16, y: 8 },
    { src: `${BASE}img/C5.png`, size: 32, y: 12 },
    { src: `${BASE}img/T3.png`, size: 20, y: 8 },
    { src: `${BASE}img/T14.png`, size: 16, y: 8 },
    { src: `${BASE}img/T15.png`, size: 16, y: 8 },
  ]

  // Arrays consumed by the renderer
  const portraitImages = useMemo(() => portraitList.map(p => p.src), [])
  const [imgItems, setImgItems] = useState(() => portraitList.map(p => ({ size: p.size, y: p.y })))

  const [uiKey, setUiKey] = useState(0)
  const [panelKey, setPanelKey] = useState(0)

  const fileRef = useRef(null)
  function saveToTxt() {
    const settings = { sky, env, coaster, rain, imgRing, imgItems, orbit: { autoRotate } }
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
      if (parsed.rain) setRain(s => ({ ...s, ...parsed.rain }))
      if (parsed.imgRing) setImgRing(s => ({ ...s, ...parsed.imgRing }))
      if (parsed.imgItems && Array.isArray(parsed.imgItems)) {
        setImgItems(() => {
          // Align length to current images
          return portraitImages.map((_, i) => {
            const it = parsed.imgItems[i]
            return { size: it?.size ?? defaultImgRing.size, y: it?.y ?? defaultImgRing.y }
          })
        })
      }
      if (parsed.orbit && typeof parsed.orbit.autoRotate === 'boolean') setAutoRotate(parsed.orbit.autoRotate)
      setPanelKey(k => k + 1)
      setUiKey(k => k + 1)
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
      <RainPanel key={`rain-${panelKey}`} panelKey={panelKey} rain={rain} setRain={setRain} />
      <ImageRingPanel key={`img-${panelKey}`} panelKey={panelKey} imgRing={imgRing} setImgRing={setImgRing} />

      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 2, 0], fov: 60, near: 0.1, far: 4000 }}
        gl={{ antialias: true, alpha: false }}
      >
        <ambientLight intensity={0.2} />

        <Suspense fallback={null}>
          {/* Images arranged in a circle; per-image size & y come from portraitList -> imgItems */}
          <ImageRing
            enabled={imgRing.enabled}
            images={portraitImages}
            radius={imgRing.radius}
            y={imgRing.y}              // fallback default
            size={imgRing.size}        // fallback default
            items={imgItems}           // per-image {size, y}
            mode={imgRing.mode}
            opacity={imgRing.opacity}
          />
        </Suspense>

        <Rain
          enabled={rain.enabled}
          count={rain.count}
          areaRadius={rain.areaRadius}
          areaHeight={rain.areaHeight}
          groundY={env.yBase}
          speed={rain.speed}
          length={rain.length}
          windX={rain.windX}
          windZ={rain.windZ}
          color={rain.color}
          opacity={rain.opacity}
        />

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
            yOffset={coaster.yOffset}
            useTrackNormal={coaster.useTrackNormal}
            speedScale={coaster.speedScale}
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
