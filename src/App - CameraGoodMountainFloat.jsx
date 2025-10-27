// src/App.jsx
import React, { useMemo, useRef, useEffect, useState, Suspense } from 'react'
import * as THREE from 'three'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, useTexture, Billboard } from '@react-three/drei'

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

function CameraWorldRing({
  images = [],
  radius = 4,
  heightOffset = 0,
  size = 1.6,
  opacity = 1,
  // NEW: audio-driven props
  audioRef = null,
  spectrum = null,     // [{ t, bands:[20] }, ...]
  jumpAmp = 2.5,
  scalePulse = 0.25,
  smooth = 0.88
}) {
  const { camera } = useThree()
  const spriteRefs = useRef([])
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

  const angles = useMemo(
    () => images.map((_, i) => (i / images.length) * Math.PI * 2),
    [images]
  )

  // RANDOM band index for each sprite (0..19), stable for this mount
  const bandMap = useMemo(
    () => images.map(() => Math.floor(Math.random() * 16)),
    [images]
  )

  const ySmooth = useRef(new Float32Array(images.length))
  const cursor = useRef(0)

  // last spectrum time (for wrapping)
  const lastT = useMemo(
    () => (spectrum && spectrum.length ? spectrum[spectrum.length - 1].t || 0 : 0),
    [spectrum]
  )

  // Interpolated bands at time t
  const tmpBandsRef = useRef(null)
  const bandsAt = (t) => {
    const data = spectrum
    if (!data || !data.length) return null

    // Wrap time if we know the total length
    const tt = lastT > 0 ? (t % lastT) : t

    let i = Math.min(cursor.current, data.length - 1)
    while (i + 1 < data.length && data[i + 1].t <= tt) i++
    while (i > 0 && data[i].t > tt) i--
    cursor.current = i

    const a = data[i]
    const b = data[i + 1] || a
    const f = b.t > a.t ? (tt - a.t) / (b.t - a.t) : 0

    const out = tmpBandsRef.current || (tmpBandsRef.current = new Float32Array(20))
    for (let k = 0; k < 20; k++) {
      const av = a.bands?.[k] ?? 0
      const bv = b.bands?.[k] ?? 0
      out[k] = av + (bv - av) * f
    }
    return out
  }

  // Place sprites around + face the camera; apply jump/scale from assigned band
  useFrame((_, dtRaw) => {
    if (!images.length) return
    const dt = Math.min(dtRaw, 0.05)
    const cx = camera.position.x
    const cy = camera.position.y + heightOffset
    const cz = camera.position.z

    const tAudio = audioRef?.current ? audioRef.current.currentTime : null
    const bands = tAudio != null ? bandsAt(tAudio) : null
    const lerpK = 1 - Math.pow(1 - smooth, dt * 60)

    angles.forEach((a, i) => {
      const s = spriteRefs.current[i]
      if (!s) return

      const x = cx + Math.cos(a) * radius
      const z = cz + Math.sin(a) * radius

      let jump = 0
      if (bands) {
        const bi = bandMap[i] // RANDOM assigned band for this sprite
        const energy = Math.max(0, bands[bi] ?? 0)
        const target = energy * jumpAmp
        const prev = ySmooth.current[i] || 0
        jump = prev + (target - prev) * lerpK
        ySmooth.current[i] = jump

        const sPulse = 1 + jump * scalePulse
        s.scale.set(size * sPulse, size * sPulse, 1)
      } else {
        s.scale.set(size, size, 1)
        ySmooth.current[i] *= (1 - lerpK)
        jump = ySmooth.current[i]
      }

      s.position.set(x, cy + jump, z)
      s.quaternion.copy(camera.quaternion)
    })
  })

  if (!images.length) return null
  return (
    <group>
      {angles.map((_, i) => {
        const map = Array.isArray(maps) ? maps[i] : maps
        if (!map) return null
        return (
          <sprite key={i} ref={(el) => (spriteRefs.current[i] = el)} scale={[size, size, 1]}>
            <spriteMaterial
              map={map}
              transparent
              opacity={opacity}
              depthTest
              depthWrite={false}
              fog={false}
              toneMapped={false}
            />
          </sprite>
        )
      })}
    </group>
  )
}


function MotionDetector({ onChange }) {
  const videoRef = React.useRef(null)
  const prevLmRef = React.useRef(null)
  const smoothRef = React.useRef(0)
  const poseRef = React.useRef(null)
  const rafRef = React.useRef(0)
  const waitingGesture = React.useRef(false)
  const startedRef = React.useRef(false)

  // ——— bases in order we’ll try ———
  const PUBLIC_BASE = (typeof BASE === 'string' && BASE) ? BASE : '/'
  const LOCAL_BASE = new URL(`${PUBLIC_BASE}vendor/mediapipe/`, window.location.href).href
  const CDN_UNPKG = 'https://unpkg.com/@mediapipe/pose@0.5.167/'
  const CDN_JSD   = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.167/'
  const BASES = [LOCAL_BASE, CDN_UNPKG, CDN_JSD]

  // quick <script> loader
  const loadTag = (src) =>
    new Promise((res, rej) => {
      const s = document.createElement('script')
      s.src = src
      s.async = true
      s.onload = () => res(src)
      s.onerror = () => rej(new Error(`Failed to load <script> ${src}`))
      document.head.appendChild(s)
    })

  // sanity-check a base has the essential files (avoid loading broken sources)
  async function probeBase(base) {
    const must = [
      'pose.js',
      'pose_solution_packed_assets_loader.js',
      // these two are chosen dynamically; presence of either is fine
      'pose_solution_simd_wasm_bin.js',
      'pose_solution_wasm_bin.js',
      'pose_solution_packed_assets.data',
      'pose_landmark_lite.tflite',
    ]
    try {
      // Only probe a subset thoroughly to avoid big downloads
      const checks = await Promise.all([
        fetch(base + 'pose.js', { cache: 'no-store' }),
        fetch(base + 'pose_solution_packed_assets_loader.js', { cache: 'no-store' }),
        fetch(base + 'pose_solution_packed_assets.data', { cache: 'no-store' }),
      ])
      if (!checks.every(r => r.ok)) return false

      // If those three exist, we assume the rest are there (simd/wasm/lite)
      return true
    } catch {
      return false
    }
  }

  // main loader for a given base
  async function loadPoseFrom(baseHref) {
    // 1) verify the base (only for local to avoid CORS surprises)
    if (baseHref === LOCAL_BASE) {
      const ok = await probeBase(baseHref)
      if (!ok) throw new Error(`Local assets missing or unreachable at ${baseHref}`)
    }

    // 2) load the UMD
    await loadTag(`${baseHref}pose.js`)

    // 3) resolve constructor across UMD variants
    const PoseNS = window.Pose || window.pose
    const PoseCtor = PoseNS?.Pose || PoseNS
    if (typeof PoseCtor !== 'function') {
      console.error('pose.js loaded, but no Pose constructor on window:', { Pose: window.Pose, pose: window.pose })
      throw new Error('Pose constructor not found')
    }

    // 4) create instance
    const pose = new PoseCtor({
      // must be ABSOLUTE so workers don’t resolve relative to blob URLs
      locateFile: (f) => baseHref + f,
    })

    // 5) callbacks first
    pose.onResults(onResults)

    // 6) wait for WASM/graph to be ready before setOptions
    if (typeof pose.initialize === 'function') {
      await pose.initialize()
    } else {
      // older builds – tiny delay so packed_assets loader runs
      await new Promise(r => setTimeout(r, 100))
    }

    // 7) now set options
    pose.setOptions({
      selfieMode: true,
      modelComplexity: 0,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })

    return pose
  }

  // try bases in order; throw last error if all fail
  async function loadPose() {
    let lastErr = null
    for (const base of BASES) {
      try {
        console.log('[MotionDetector] loading pose from:', base)
        const p = await loadPoseFrom(base)
        console.log('[MotionDetector] pose loaded from:', base)
        return p
      } catch (e) {
        console.warn('[MotionDetector] failed from base:', base, e)
        lastErr = e
      }
    }
    throw lastErr || new Error('All pose bases failed')
  }

  // movement calc
// inside MotionDetector
const onResults = React.useCallback((res) => {
  const lm = res.poseLandmarks
  if (!lm) { onChange?.(0); prevLmRef.current = null; return }

  // Use only stable torso joints: shoulders (11,12) & hips (23,24)
  const IDX = [11, 12, 23, 24]

  const pick = (i) => {
    const p = lm[i]; return { x: p.x, y: p.y, z: p.z ?? 0, v: p.visibility ?? 0 }
  }
  const curr = IDX.map(pick)
  const prev = prevLmRef.current

  let mv = 0, n = 0
  if (prev && prev.length === curr.length) {
    for (let k = 0; k < IDX.length; k++) {
      const a = curr[k], b = prev[k]
      const visOk = (a.v > 0.6) && (b.v > 0.6)
      if (!visOk) continue
      mv += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
      n++
    }
    mv = n ? mv / n : 0
  }

  // Heavier smoothing + smaller scale
  const K_SMOOTH = 0.08     // was 0.2
  const SCALE    = 10       // was 40

  // Dead-zone with hysteresis
  const DEAD    = 0.015     // 1.5% normalized jitter ~ “still”
  const DEAD_LO = DEAD * 0.6

  let raw = Math.min(1, mv * SCALE)
  let out = smoothRef.current * (1 - K_SMOOTH) + raw * K_SMOOTH

  // Apply hysteresis: once we're at zero, require passing DEAD to wake up
  const wasZero = smoothRef.current === 0
  if (wasZero && out < DEAD) out = 0
  else if (!wasZero && out < DEAD_LO) out = 0

  smoothRef.current = out
  onChange?.(out)
  prevLmRef.current = curr
}, [onChange])


  const loop = React.useCallback(async () => {
    const v = videoRef.current
    if (poseRef.current && v && v.readyState >= 2) {
      try { await poseRef.current.send({ image: v }) } catch {}
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [])

  const start = React.useCallback(async () => {
    if (startedRef.current) return
    startedRef.current = true
    try {
      poseRef.current = await loadPose()

      const v = videoRef.current
      v.playsInline = true; v.setAttribute('playsinline', '')
      v.muted = true;      v.setAttribute('muted', '')
      v.autoplay = true

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 }, audio: false
      })
      v.srcObject = stream
      await v.play().catch(() => {})

      // warm-up frames
      for (let i = 0; i < 2; i++) {
        if (poseRef.current && v.readyState >= 2) {
          await poseRef.current.send({ image: v })
        }
      }

      rafRef.current = requestAnimationFrame(loop)
      waitingGesture.current = false
      console.log('[MotionDetector] camera running')
    } catch (e) {
      waitingGesture.current = true
      startedRef.current = false
      console.warn('[MotionDetector] start failed; will retry on user gesture:', e)
    }
  }, [loop])

  React.useEffect(() => {
    // needs HTTPS or http://localhost
    if (!window.isSecureContext && !location.origin.startsWith('http://localhost')) {
      console.warn('Camera requires HTTPS or http://localhost')
      return
    }
    start()
    const retry = () => { if (waitingGesture.current) start() }
    window.addEventListener('pointerdown', retry)
    window.addEventListener('keydown', retry)
    return () => {
      window.removeEventListener('pointerdown', retry)
      window.removeEventListener('keydown', retry)
      cancelAnimationFrame(rafRef.current)
      try { poseRef.current?.close() } catch {}
      const s = videoRef.current?.srcObject
      if (s) s.getTracks().forEach(t => t.stop())
    }
  }, [start])

  return (
    <video
      ref={videoRef}
      style={{ position:'fixed', width:1, height:1, opacity:0, pointerEvents:'none' }}
    />
  )
}







/* -------------------- Moon System (moon + 3 orbiting sprites) -------------------- */
/**
 * Places a moon that orbits the world origin, and a ring of sprites (w1..w3)
 * that orbit around the moon.
 */
/* -------------------- Moon System (moon + 3 orbiting sprites) -------------------- */
/* -------------------- Moon System (moon + 3 orbiting sprites) -------------------- */
/**
 * Places a moon that orbits the world origin, and a ring of sprites (w1..w3)
 * that orbit around the moon. Flips w1 & w2 horizontally via texture repeat/offset.
 */
function MoonSystem({
  moonTexture = `${BASE}img/moon.png`,
  ringTextures = [`${BASE}img/w1.png`, `${BASE}img/w2.png`, `${BASE}img/w3.png`],
  // moon orbit around the scene
  moonOrbitRadius = 36,
  moonHeight = 18,
  moonOrbitSpeed = 0.06,
  moonSize = 3,
  // ring that orbits the moon
  ringRadius = 42,
  ringSpinSpeed = 0.5,
  ringSpriteSize = [6,6,6], // per-sprite sizes (w1,w2,w3)
  // which indices to flip horizontally (0 = w1, 1 = w2, 2 = w3)
  flipXIndices = [0, 1]
}) {
  const groupRef = useRef()      // moves the moon around the scene
  const ringRef = useRef()       // spins the w-sprites around the moon
  const moonRef = useRef()

  // Load textures
  const moonMap  = useTexture(moonTexture)
  const ringMaps = useTexture(ringTextures)

  useEffect(() => {
    // Ensure proper color space for all textures
    if (moonMap) {
      if ('colorSpace' in moonMap) moonMap.colorSpace = THREE.SRGBColorSpace
      else if ('encoding' in moonMap) moonMap.encoding = THREE.sRGBEncoding
      moonMap.needsUpdate = true
    }
    const arr = Array.isArray(ringMaps) ? ringMaps : [ringMaps]
    arr.forEach((m, i) => {
      if (!m) return
      // color space
      if ('colorSpace' in m) m.colorSpace = THREE.SRGBColorSpace
      else if ('encoding' in m) m.encoding = THREE.sRGBEncoding

      // 🔁 Horizontal flip for chosen indices (w1, w2 by default)
      if (flipXIndices.includes(i)) {
        m.wrapS = THREE.RepeatWrapping
        m.repeat.x = -1
        m.offset.x = 1
      } else {
        // make sure non-flipped are normal
        m.wrapS = THREE.ClampToEdgeWrapping
        m.repeat.x = 1
        m.offset.x = 0
      }
      m.needsUpdate = true
    })
  }, [moonMap, ringMaps, flipXIndices])

  // Precompute equal angles for N sprites
  const ringAngles = useMemo(() => {
    const out = []
    const n = Array.isArray(ringMaps) ? ringMaps.length : 0
    for (let i = 0; i < n; i++) out.push((i / n) * Math.PI * 2)
    return out
  }, [ringMaps])

  // Animate: moon group orbits world; ring spins around moon
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()

    // Moon orbit around world origin (XZ circle at fixed height)
    const x = Math.cos(t * moonOrbitSpeed) * moonOrbitRadius
    const z = Math.sin(t * moonOrbitSpeed) * moonOrbitRadius
    if (groupRef.current) groupRef.current.position.set(x, moonHeight, z)

    // Spin the ring of sprites around the moon
    if (ringRef.current) ringRef.current.rotation.y = -t * ringSpinSpeed

    // Optional tiny moon roll
    if (moonRef.current) moonRef.current.rotation.z = t * 0.05
  })

  return (
    <group ref={groupRef}>
      {/* Moon at the center of the local group */}
      <sprite ref={moonRef} scale={[moonSize, moonSize, 1]}>
        <spriteMaterial map={moonMap} transparent depthWrite={false} toneMapped={false} />
      </sprite>

      {/* Orbiting ring of sprites */}
      <group ref={ringRef}>
        {Array.isArray(ringMaps) && ringMaps.map((tex, i) => {
          const a = ringAngles[i]
          const px = Math.cos(a) * ringRadius
          const pz = Math.sin(a) * ringRadius
          const s  = ringSpriteSize[i] ?? ringSpriteSize[0] ?? 1.6
          // NOTE: keep positive scale; flip is done via texture repeat/offset
          return (
            <sprite key={i} position={[px, 0, pz]} scale={[s, s, 1]}>
              <spriteMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
            </sprite>
          )
        })}
      </group>
    </group>
  )
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
  
	  // PU images (public/img/Pu1.png ... Pu33.png)
	const puImages = useMemo(
	  () => Array.from({ length: 33 }, (_, i) => `${BASE}img/Pu${i + 1}.png`),
	  []
	)

	// Tweakable ring params
	const puRing = { radius: 64, heightOffset: -2, size: 3. }

// === Audio + spectrum (autoplay) ===
	const [spec, setSpec] = useState(null)
	const audioRef = useRef(null)

	useEffect(() => {
	  fetch(`${BASE}FunnyHalloween.json`, { cache: 'force-cache' })
		.then(r => r.json())
		.then(setSpec)
		.catch(e => console.warn('Spectrum load failed:', e))
	}, [])

	// Try to autoplay; if blocked, start on first pointer/touch
	useEffect(() => {
	  const a = audioRef.current
	  if (!a) return
	  const tryPlay = () => a.play().catch(() => {})
	  tryPlay()
	  const onInteract = () => { tryPlay(); window.removeEventListener('pointerdown', onInteract) }
	  window.addEventListener('pointerdown', onInteract)
	  return () => window.removeEventListener('pointerdown', onInteract)
	}, [])

  const [motionValue, setMotionValue] = useState(0)

  const [sky, setSky] = useState(defaultSky)
  const [env, setEnv] = useState(defaultEnv)
  const [coaster, setCoaster] = useState(defaultCoaster)
  const [rain, setRain] = useState(defaultRain)
  const [imgRing, setImgRing] = useState(defaultImgRing)
  const [autoRotate, setAutoRotate] = useState(true)

  // Single list that controls each image's size & heightY
  const portraitList = [
    { src: `${BASE}img/C1.png`, size: 36, y: 18 },
    { src: `${BASE}img/s1.png`, size: 20, y: 8 },
    { src: `${BASE}img/T5.png`, size: 16, y: 8 },
    { src: `${BASE}img/T20.png`, size: 10, y: 7 },		
    { src: `${BASE}img/T6.png`, size: 16, y: 8 },
    { src: `${BASE}img/C2.png`, size: 38, y: 16 },
    { src: `${BASE}img/s2.png`, size: 20, y: 6 },
    { src: `${BASE}img/T18.png`, size: 18, y: 6 },
    { src: `${BASE}img/T7.png`, size: 16, y: 6 },
    { src: `${BASE}img/T8.png`, size: 16, y: 6 },
    { src: `${BASE}img/C3.png`, size: 32, y: 15 },
    { src: `${BASE}img/T16.png`, size: 16, y: 6 },
    { src: `${BASE}img/T1.png`, size: 20, y: 6 },
    { src: `${BASE}img/T9.png`, size: 16, y: 6 },
    { src: `${BASE}img/C4.png`, size: 36, y: 16 },
    { src: `${BASE}img/T11.png`, size: 16, y: 8 },
    { src: `${BASE}img/T2.png`, size: 20, y: 8 },
    { src: `${BASE}img/T12.png`, size: 16, y: 8 },
    { src: `${BASE}img/C5.png`, size: 32, y: 12 },
    { src: `${BASE}img/T3.png`, size: 20, y: 7 },
    { src: `${BASE}img/T14.png`, size: 16, y: 8 },
    { src: `${BASE}img/T15.png`, size: 16, y: 8 },
  ]

  const portraitImages = useMemo(() => portraitList.map(p => p.src), [])
  const [imgItems, setImgItems] = useState(() => portraitList.map(p => ({ size: p.size, y: p.y })))

  // Auto-load settings from /public/purple-mountains-settings.txt on mount
  useEffect(() => {
    const url = `${BASE}purple-mountains-settings.txt`
    ;(async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) {
          console.warn('Settings file not found or not ok:', res.status)
          return
        }
        const text = await res.text()
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
        if (parsed.orbit && typeof parsed.orbit.autoRotate === 'boolean') {
          setAutoRotate(parsed.orbit.autoRotate)
        }
      } catch (err) {
        console.warn('Failed to load purple-mountains-settings.txt:', err)
      }
    })()
  }, [portraitImages])

  return (
    <>
	{/* MediaPipe Pose movement detector */}
	<MotionDetector onChange={setMotionValue} />  {/* turn off later by removing showPreview */}
      <div style={{
	  position: 'fixed',
	  top: 12,
	  left: 12,
	  background: 'rgba(0,0,0,0.55)',
	  color: '#9aff9a',
	  padding: '8px 10px',
	  borderRadius: 8,
	  fontFamily: 'monospace',
	  zIndex: 1000,
	  pointerEvents: 'none'
	}}>
	  movement: {motionValue.toFixed(3)}
	</div>

	  
		<audio
		  ref={audioRef}
		  src={`${BASE}FunnyHalloween.mp3`}
		  preload="auto"
		  loop
		  autoPlay
		  playsInline
		/>


      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 2, 0], fov: 60, near: 0.1, far: 4000 }}
        gl={{ antialias: true, alpha: false }}
      >
        <ambientLight intensity={0.2} />

        <Suspense fallback={null}>
          {/* Images arranged in a circle; per-image size & y come from imgItems */}
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
          {/* 🌙 Moon with three orbiting sprites */}
          <MoonSystem />
		  
			<CameraWorldRing
			  images={puImages}
			  radius={puRing.radius}
			  heightOffset={puRing.heightOffset}
			  size={puRing.size}
			  opacity={1}
			  audioRef={audioRef}          // NEW
			  spectrum={spec}              // NEW (loaded JSON)
			  jumpAmp={3}                // tweak to taste
			  scalePulse={0.36}
			  smooth={0.3}
			/>

        </Suspense>

        <OrbitControls
		  enableZoom={false}
		  enablePan={false}
		  enableDamping
		  dampingFactor={0.1}
		  autoRotate={autoRotate}
		  autoRotateSpeed={0.5}

		  // NEW: look straight ahead from y=2
		  target={[1, 2, 0]}
		  // NEW: keep horizon (no looking down/up)
			minPolarAngle={Math.PI * 0.25}  // ~81°
			maxPolarAngle={Math.PI * 0.85}  // ~99°
        />
      </Canvas>
    </>
  )
}
