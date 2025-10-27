// src/App.jsx
import React, { useMemo, useRef, useEffect, useState, Suspense } from 'react'
import * as THREE from 'three'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, useTexture, Billboard } from '@react-three/drei'
import { Html } from '@react-three/drei'


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

/* ---- tiny deterministic RNG ---- */
function makeRNG(seed = 123456789) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

/* -------------------- Hill (simple hemisphere) -------------------- */
function Hill({ color = '#1a1026', radius = 3, height = 1, width = 1.8, position = [0, 0, 0] }) {
  return (
    <group position={position} scale={[width, height, width]}>
      <mesh>
        <sphereGeometry args={[radius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  )
}

	/* -------------------- HillRing (calculate once) -------------------- */
	function HillRing({
	  count = 24,
	  radius = 40,
	  y = -1.2,
	  color = '#120a1b',
	  minR = 3,
	  maxR = 7,
	  minH = 0.6,
	  maxH = 1.2,
	  width = 1.8,
	  jitter = 2.5,
	  seed = 1, // stable seed per ring
	}) {
	  // Build all hill instances once on first render
	  const hillsRef = React.useRef(null)
	  if (!hillsRef.current) {
		const rnd = makeRNG(seed)
		const base = ringPositions(count, radius)
		hillsRef.current = base.map(([x, , z]) => {
		  const jx = (rnd() - 0.5) * jitter
		  const jz = (rnd() - 0.5) * jitter
		  return {
			position: [x + jx, y, z + jz],
			radius: THREE.MathUtils.lerp(minR, maxR, rnd()),
			height: THREE.MathUtils.lerp(minH, maxH, rnd()),
			width: width * (0.85 + rnd() * 0.3),
		  }
		})
	  }

	  const hills = hillsRef.current
	  return (
		<>
		  {hills.map((h, i) => (
			<Hill
			  key={i}
			  color={color}
			  radius={h.radius}
			  height={h.height}
			  width={h.width}
			  position={h.position}
			/>
		  ))}
		</>
	  )
	}

	/* -------------------- Mountains (rings calculated once) -------------------- */
	function Mountains({
	  ringCount,
	  hillsPerRing,
	  baseRadius,
	  ringSpacing,
	  nearColor,
	  farColor,
	  yBase,
	  fogDensity,
	  seed = 1234, // master seed for the whole mountain set
	}) {
	  const { scene } = useThree()

	  // Fog can update without affecting static geometry
	  useEffect(() => {
		scene.fog = new THREE.FogExp2(new THREE.Color('#0e0818'), fogDensity)
		return () => { scene.fog = null }
	  }, [scene, fogDensity])

	  // Precompute ring descriptors once
	  const ringsRef = React.useRef(null)
	  if (!ringsRef.current) {
		ringsRef.current = Array.from({ length: ringCount }, (_, i) => {
		  const t = (i + 1) / Math.max(1, ringCount)
		  return {
			i,
			color: lerpColor(farColor, nearColor, t),
			y: yBase + i * 0.05,
			radius: baseRadius + i * ringSpacing,
			count: hillsPerRing + i * 2,
			seed: seed + i * 101, // unique seed per ring
		  }
		})
	  }

	  const rings = ringsRef.current
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
			  seed={r.seed}
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
function BatsJumpHtml({
  gifUrl = `${BASE}img/bat.gif`,
  count = 8,
  radius = 80,         // = outerMountainRadius
  baseY = 18,          // resting height on the ring
  pixelWidth = 200,    // CSS size of gif
  // motion → jump mapping
  motion = 0,          // pass motionValue here
  dead = 20,           // ignore tiny motion
  sens = 220,          // sensitivity
  maxJump = 8,         // max jump height in world units
  // flavor
  wobbleAmp = 0.6,
  wobbleFreq = 2.0,
  spinSpeed = 0.05,    // slow spin around ring (set 0 to disable)
  smooth = 0.25        // 0..1; higher = snappier smoothing
}) {
  const group = useRef()
  const nodes = useRef([])
  useEffect(() => { nodes.current = nodes.current.slice(0, count) }, [count])

  // even angles + tiny per-bat jitter & phases
  const bats = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      baseAng: (i / count) * Math.PI * 2,
      jitter: (Math.random() - 0.5) * 0.12,
      wobPhase: Math.random() * Math.PI * 2,
      wobMul: 0.75 + Math.random() * 0.5,    // varied wobble speed
      jumpCurr: 0                             // smoothed jump
    }))
  , [count])

  // map motion → target jump [0..maxJump]
  const jumpTarget = useMemo(() => {
    const m = Math.max(0, motion - dead)
    const t = 1 - Math.exp(-m / sens)      // nice easing 0..1
    return t * maxJump
  }, [motion, dead, sens, maxJump])

  // smooth helper
  const lerpExp = (a, b, dt, s= smooth) => a + (b - a) * (1 - Math.pow(1 - s, dt * 60))

  useFrame(({ clock }, dtRaw) => {
    const t = clock.getElapsedTime()
    const dt = Math.min(dtRaw, 0.05)
    for (let i = 0; i < bats.length; i++) {
      const b = bats[i]
      const n = nodes.current[i]
      if (!n) continue

      // smooth the jump toward the current target
      b.jumpCurr = lerpExp(b.jumpCurr, jumpTarget, dt)

      // wobble dies a bit as jump grows (keeps it tidy up high)
      const wob = Math.sin((t * wobbleFreq * b.wobMul) + b.wobPhase) *
                  wobbleAmp * (1 - Math.min(1, b.jumpCurr / Math.max(1e-4, maxJump)))

      const ang = b.baseAng + b.jitter + (spinSpeed ? t * spinSpeed : 0)
      const x = Math.cos(ang) * radius
      const z = Math.sin(ang) * radius
      const y = baseY + b.jumpCurr + wob

      n.position.set(x, y, z)
    }
  })

  return (
    <group ref={group}>
      {bats.map((_, i) => (
        <group key={i} ref={el => (nodes.current[i] = el)}>
          <Html sprite center transform>
            <img
              src={gifUrl}
              alt="bat"
              style={{
                width: `${pixelWidth}px`,
                height: 'auto',
                pointerEvents: 'none',
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.75))'
              }}
            />
          </Html>
        </group>
      ))}
    </group>
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

/* ==================== LIGHTNING: CLASSIC ==================== */
// local PRNG so shape is deterministic per strike
function mulberry32(seed) {
  return function() {
    let t = (seed += 0x6D2B79F5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function randomPerpRand(dir, rand) {
  const v = new THREE.Vector3(rand()-0.5, rand()-0.5, rand()-0.5)
  const proj = dir.clone().multiplyScalar(v.dot(dir) / Math.max(1e-6, dir.lengthSq()))
  v.sub(proj).normalize()
  if (!Number.isFinite(v.x)) v.set(0,1,0)
  return v
}
function makeBoltPointsRand(a, b, { subdivisions = 6, sway = 1.2, roughness = 0.62 } = {}, rand) {
  let pts = [a.clone(), b.clone()]
  let disp = sway * a.distanceTo(b) * 0.05
  for (let i = 0; i < subdivisions; i++) {
    const next = [pts[0]]
    for (let j = 0; j < pts.length - 1; j++) {
      const p0 = pts[j], p1 = pts[j+1]
      const mid = p0.clone().add(p1).multiplyScalar(0.5)
      const dir = p1.clone().sub(p0)
      const n = randomPerpRand(dir, rand).multiplyScalar((rand()*2-1) * disp)
      mid.add(n)
      next.push(mid, p1)
    }
    pts = next
    disp *= roughness
  }
  return pts
}
function enforceDownward(pts, minStep = 0.02) {
  const out = pts.map(p => p.clone())
  let lastY = out[0].y
  for (let i = 1; i < out.length; i++) {
    if (out[i].y >= lastY - minStep) {
      out[i].y = lastY - (minStep + Math.random() * 0.04)
    }
    lastY = out[i].y
  }
  return out
}
function pickVerticalEndpointsRand(cloudY, cloudRadius, {
  topBand = [1.0, 2.6],
  minHeight = 10,
  maxHeight = 22,
  lateralJitter = 0.05
} = {}, rand) {
  const ang = rand() * Math.PI * 2
  const r   = cloudRadius * (0.35 + rand() * 0.65)
  const ay  = cloudY + THREE.MathUtils.lerp(topBand[0], topBand[1], rand())
  const a   = new THREE.Vector3(Math.cos(ang)*r, ay, Math.sin(ang)*r)
  const h   = THREE.MathUtils.lerp(minHeight, maxHeight, rand())
  const b   = new THREE.Vector3(
    a.x + (rand()*2-1) * lateralJitter,
    a.y - h,
    a.z + (rand()*2-1) * lateralJitter
  )
  return [a, b]
}

function LightningClassic({
  enabled = true,
  color = '#ffffff',
  cloudY = 20,
  cloudRadius = 40,
  // timing
  minDelay = 0.02,
  maxDelay = 0.06,
  minDur = 0.18,
  maxDur = 0.36,
  // shape
  minVerticality = 0.98,
  minHeight = 10,
  maxHeight = 22,
  lateralJitter = 0.05,
  subdivisions = 6,
  sway = 1.2,
  roughness = 0.62,
  // brightness / thickness
  power = 8.0,
  flashPower = 900,
  // determinism
  seed = 1337
}) {
  const mainGeo = React.useMemo(() => new THREE.BufferGeometry(), [])
  const thickMat = React.useMemo(() => new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false, // draw on top of rain
    fog: false,
    toneMapped: false
  }), [color])
  const thinMat  = React.useMemo(() => thickMat.clone(), [thickMat])
  const flash = React.useRef()
  const state = React.useRef({ active: false, t: 0, dur: 0.2, cooldown: 0, strikeSeed: seed })

  const setAndBound = (geo, pts) => {
    geo.setFromPoints(pts)
    geo.computeBoundingBox(); geo.computeBoundingSphere()
  }

  const build = () => {
    const rand = mulberry32((state.current.strikeSeed = (state.current.strikeSeed + 1013904223) >>> 0 || 1))
    let a, b, tries = 0
    while (true) {
      ;[a, b] = pickVerticalEndpointsRand(cloudY, cloudRadius, { minHeight, maxHeight, lateralJitter }, rand)
      const d = a.distanceTo(b)
      const v = Math.abs(a.y - b.y) / Math.max(1e-6, d)
      if (v >= minVerticality || tries++ > 10) break
    }
    let main = makeBoltPointsRand(a, b, { subdivisions, sway, roughness }, rand)
    main = enforceDownward(main)
    if (main[0].y < main[main.length - 1].y) main.reverse()
    setAndBound(mainGeo, main)
    if (flash.current) {
      const mid = main[Math.floor(main.length / 2)]
      flash.current.position.copy(mid)
    }
  }

  useFrame((_, dt) => {
    if (!enabled) return
    const s = state.current
    if (!s.active) {
      s.cooldown -= dt
      if (s.cooldown <= 0) {
        s.active = true
        s.t = 0
        s.dur = THREE.MathUtils.lerp(minDur, maxDur, Math.random())
        build()
      }
    } else {
      s.t += dt
      const e = s.t / s.dur
      const core = e < 0.08 ? e / 0.08 : Math.max(0, 1.0 - (e - 0.08) / 0.35)
      const glow = Math.max(0, 0.22 - e) * 0.7
      const o = THREE.MathUtils.clamp(core + glow, 0, 1)

      thickMat.opacity = Math.min(1, 1.0 * o * power)
      thinMat .opacity = Math.min(1, 0.7  * o * power)
      if (flash.current) flash.current.intensity = flashPower * o

      if (s.t >= s.dur) {
        s.active = false
        s.cooldown = THREE.MathUtils.lerp(minDelay, maxDelay, Math.random())
        thickMat.opacity = 0
        thinMat .opacity = 0
        if (flash.current) flash.current.intensity = 0
      }
    }
  })

  return (
    <group renderOrder={999} frustumCulled={false}>
      <line>
        <primitive object={mainGeo} attach="geometry" />
        <primitive object={thickMat} attach="material" />
      </line>
      <line>
        <primitive object={mainGeo} attach="geometry" />
        <primitive object={thinMat}  attach="material" />
      </line>
      <pointLight ref={flash} color={color} intensity={0} distance={600} decay={1.4} />
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
		  <mesh scale={items?.[i]?.scale ?? [s, s, 1]}>
			<planeGeometry args={[1, 1]} />
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


function MotionDetector({ onChange, debug=false }) {
  const videoRef = React.useRef(null)
  const prevLmRef = React.useRef(null)
  const poseRef = React.useRef(null)
  const rafRef = React.useRef(0)
  const waitingGesture = React.useRef(false)
  const startedRef = React.useRef(false)

  const PUBLIC_BASE = (typeof BASE === 'string' && BASE) ? BASE : '/'
  const LOCAL_BASE = new URL(`${PUBLIC_BASE}vendor/mediapipe/`, window.location.href).href
  const CDN_UNPKG = 'https://unpkg.com/@mediapipe/pose@0.5.167/'
  const CDN_JSD   = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.167/'
  const BASES = [LOCAL_BASE, CDN_UNPKG, CDN_JSD]

  const loadTag = (src) => new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = src; s.async = true
    s.onload = () => res(src)
    s.onerror = () => rej(new Error(`Failed to load <script> ${src}`))
    document.head.appendChild(s)
  })

  async function probeBase(base) {
    try {
      const checks = await Promise.all([
        fetch(base + 'pose.js', { cache: 'no-store' }),
        fetch(base + 'pose_solution_packed_assets_loader.js', { cache: 'no-store' }),
        fetch(base + 'pose_solution_packed_assets.data', { cache: 'no-store' }),
      ])
      return checks.every(r => r.ok)
    } catch { return false }
  }

  async function loadPoseFrom(baseHref) {
    if (baseHref === LOCAL_BASE) {
      const ok = await probeBase(baseHref)
      if (!ok) throw new Error(`Local assets missing at ${baseHref}`)
    }
    await loadTag(`${baseHref}pose.js`)
    const PoseNS = window.Pose || window.pose
    const PoseCtor = PoseNS?.Pose || PoseNS
    if (typeof PoseCtor !== 'function') throw new Error('Pose constructor not found')

    const pose = new PoseCtor({ locateFile: (f) => baseHref + f })
    pose.onResults(onResults)
    if (typeof pose.initialize === 'function') await pose.initialize()
    pose.setOptions({
      selfieMode: true,
      modelComplexity: 0,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.4,       // ↓ slight relax
      minTrackingConfidence: 0.4,
    })
    return pose
  }

  async function loadPose() {
    let lastErr = null
    for (const base of BASES) {
      try {
        debug && console.log('[MotionDetector] loading pose from:', base)
        const p = await loadPoseFrom(base)
        debug && console.log('[MotionDetector] pose loaded from:', base)
        return p
      } catch (e) { lastErr = e; console.warn('[MotionDetector] failed from base:', base, e) }
    }
    throw lastErr || new Error('All pose bases failed')
  }

  const onResults = React.useCallback((res) => {
    const lm = res.poseLandmarks
    if (debug) console.log('[MotionDetector] results?', !!lm)

    const now = performance.now()
    let st = prevLmRef.current
    if (!st || st.__v !== 3) st = (prevLmRef.current = { __v:3, y:null, t:0, out:0, last:0 })

    // throttle AFTER we know whether we got landmarks (so we can zero quickly when they’re missing)
    const MIN_GAP_MS = 1000/15
    if (now - st.last < MIN_GAP_MS) return
    st.last = now

    if (!lm) { st.out = 0; onChange?.(0); return }

    // try hips first; if not visible, fall back to shoulders to avoid hard zeros
    const takeAvg = (ids, vis=0.5) => {
      const pts = ids.map(i => lm[i]).filter(p => p && (p.visibility ?? 0) >= vis)
      if (!pts.length) return null
      const y = pts.reduce((a,p)=>a+p.y, 0) / pts.length
      return y
    }

    let y = takeAvg([23,24], 0.5)  // hips (R/L)
    if (y == null) y = takeAvg([11,12], 0.5) // shoulders fallback
    if (y == null) { st.out = 0; onChange?.(0); return }

    if (st.y == null) { st.y = y; st.t = now; st.out = 0; onChange?.(0); return }

    const dt = Math.max(1e-3, (now - st.t)/1000)
    const vy  = (st.y - y) / dt          // up > 0
    const DEAD = 0.0015                   // ↓ smaller deadzone
    const speed = Math.max(0, Math.abs(vy) - DEAD)

    // combine speed + a little “lift” against a slow-moving ground
    st.g = st.g ?? y
    const targetG = Math.max(y, st.g)
    st.g = st.g*0.985 + targetG*0.015
    const lift = Math.max(0, st.g - y)

    const raw = speed*1100 + lift*550
    const ALPHA = 0.7
    st.out = ALPHA*raw + (1-ALPHA)*st.out
    if (speed <= 0 && lift < 0.002) st.out = 0 // hard zero when really idle

    onChange?.(st.out)
    debug && console.log('[MotionDetector] mv=', st.out.toFixed(2), 'vy=', vy.toFixed(4), 'lift=', lift.toFixed(4))

    st.y = y; st.t = now
  }, [onChange, debug])

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
      v.playsInline = true; v.muted = true; v.autoplay = true
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'user', width:640, height:480 }, audio:false })
      v.srcObject = stream
      await v.play().catch(()=>{})
      for (let i=0;i<2;i++) if (poseRef.current && v.readyState>=2) await poseRef.current.send({ image:v })
      rafRef.current = requestAnimationFrame(loop)
      console.log('[MotionDetector] camera running')
    } catch (e) {
      waitingGesture.current = true
      startedRef.current = false
      console.warn('[MotionDetector] start failed; will retry on user gesture:', e)
    }
  }, [loop])

  React.useEffect(() => {
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
      const s = videoRef.current?.srcObject; if (s) s.getTracks().forEach(t => t.stop())
    }
  }, [start])

  return (
    <video
      ref={videoRef}
      style={{
        position:'fixed',
        width: debug ? 240 : 1,
        height: debug ? 180 : 1,
        bottom: debug ? 12 : 'auto',
        right: debug ? 12 : 'auto',
        border: debug ? '1px solid #0f0' : 'none',
        opacity: debug ? 0.85 : 0,
        zIndex: 99999,
        pointerEvents: 'none',
      }}
    />
  )
}







/* -------------------- Moon System (moon + 3 orbiting sprites) -------------------- */
/**
 * Places a moon that orbits the world origin, and a ring of sprites (w1..w3)
 * that orbit around the moon.
 */
function MoonSystem({
  moonTexture = `${BASE}img/moon.png`,
  ringTextures = [
    `${BASE}img/w1.png`, `${BASE}img/w2.png`, `${BASE}img/w4.png`,
    `${BASE}img/w5.png`, `${BASE}img/w6.png`, `${BASE}img/w7.png`
  ],

  // world orbit
  moonOrbitRadius = 36,
  moonHeight = 18,
  moonOrbitSpeed = 0.06,

  // these are the *targets* you pass from App (can change each frame)
  moonSize = 8,             // target size (linked to motion)
  ringSpinSpeed = 1,      // target spin (linked to motion)

  ringRadius = 60,
  ringSpriteSize = [6,6,6,6,6,6],
  flipXIndices = [0, 1],

  // smoothing + anti-wagon-wheel
  smooth = 0.18,
  compensateCamera = true,
  cameraCompFactor = 1,
}) {
  const { camera } = useThree()
  const groupRef = useRef()
  const ringRef  = useRef()
  const moonRef  = useRef()

  // --- textures ---
  const moonMap  = useTexture(moonTexture)
  const ringMaps = useTexture(ringTextures)
  useEffect(() => {
    if (moonMap) {
      if ('colorSpace' in moonMap) moonMap.colorSpace = THREE.SRGBColorSpace
      else if ('encoding' in moonMap) moonMap.encoding = THREE.sRGBEncoding
      moonMap.needsUpdate = true
    }
    const arr = Array.isArray(ringMaps) ? ringMaps : [ringMaps]
    arr.forEach((m, i) => {
      if (!m) return
      if ('colorSpace' in m) m.colorSpace = THREE.SRGBColorSpace
      else if ('encoding' in m) m.encoding = THREE.sRGBEncoding
      if (flipXIndices.includes(i)) {
        m.wrapS = THREE.RepeatWrapping; m.repeat.x = -1; m.offset.x = 1
      } else {
        m.wrapS = THREE.ClampToEdgeWrapping; m.repeat.x = 1; m.offset.x = 0
      }
      m.needsUpdate = true
    })
  }, [moonMap, ringMaps, flipXIndices])

  // --- ring placement ---
  const ringAngles = useMemo(() => {
    const n = Array.isArray(ringMaps) ? ringMaps.length : 0
    return Array.from({ length: n }, (_, i) => (i / Math.max(1, n)) * Math.PI * 2)
  }, [ringMaps])

  // --- smoothing state (current values) ---
  const sizeCurr = useRef(moonSize)          // start from initial target
  const spinCurr = useRef(ringSpinSpeed)

  // update targets whenever props change
  const sizeTgt = useRef(moonSize)
  const spinTgt = useRef(ringSpinSpeed)
  useEffect(() => { sizeTgt.current = moonSize }, [moonSize])
  useEffect(() => { spinTgt.current = ringSpinSpeed }, [ringSpinSpeed])

  // --- incremental rotation + camera compensation ---
  const ringAngle = useRef(0)
  const prevYaw   = useRef(null)
  const TAU = Math.PI * 2
  const getYawAround = (cx, cz) => {
    const dx = camera.position.x - cx
    const dz = camera.position.z - cz
    return Math.atan2(dx, dz) // (-π, π]
  }

  useFrame(({ clock }, dtRaw) => {
    const t  = clock.getElapsedTime()
    const dt = Math.min(dtRaw, 0.05)

    // move moon around world
    const x = Math.cos(t * moonOrbitSpeed) * moonOrbitRadius
    const z = Math.sin(t * moonOrbitSpeed) * moonOrbitRadius
    groupRef.current?.position.set(x, moonHeight, z)

    // smooth current → target
    const k = 1 - Math.pow(1 - smooth, dt * 60)
    sizeCurr.current = THREE.MathUtils.lerp(sizeCurr.current, sizeTgt.current, k)
    spinCurr.current = THREE.MathUtils.lerp(spinCurr.current, spinTgt.current, k)

    // apply smoothed size + gentle roll
    if (moonRef.current) {
      const s = sizeCurr.current
      moonRef.current.scale.set(s, s, 1)
      moonRef.current.rotation.z = t * 0.05
    }

    // compensate camera yaw around the moon’s center
    let dYaw = 0
    if (compensateCamera && groupRef.current) {
      const yaw = getYawAround(groupRef.current.position.x, groupRef.current.position.z)
      if (prevYaw.current == null) prevYaw.current = yaw
      dYaw = yaw - prevYaw.current
      if (dYaw > Math.PI) dYaw -= TAU
      if (dYaw < -Math.PI) dYaw += TAU
      prevYaw.current = yaw
    }

    // incremental rotation (prevents perceived “backwards”)
    const MAX_STEP = 0.35
    const ownStep  = THREE.MathUtils.clamp(spinCurr.current * dt, -MAX_STEP, MAX_STEP)
    const camStep  = dYaw * cameraCompFactor

    ringAngle.current = (ringAngle.current - ownStep - camStep) % TAU
    if (ringRef.current) ringRef.current.rotation.y = ringAngle.current
  })

  return (
    <group ref={groupRef}>
      <sprite ref={moonRef} scale={[moonSize, moonSize, 1]}>
        <spriteMaterial map={moonMap} transparent depthWrite={false} toneMapped={false} />
      </sprite>

      <group ref={ringRef}>
        {Array.isArray(ringMaps) && ringMaps.map((tex, i) => {
          const a = ringAngles[i]
          const px = Math.cos(a) * ringRadius
          const pz = Math.sin(a) * ringRadius
          const s  = ringSpriteSize[i] ?? ringSpriteSize[0] ?? 1.6
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

function ScoreTicker({ gameActive, motionValue, scoreRef, setScore }) {
  useFrame((_, dtRaw) => {
    if (!gameActive) return
    const dt = Math.min(dtRaw, 0.05)
    const energy = 1 - Math.exp(-Math.max(0, motionValue - 20) / 180) // 0..1
    scoreRef.current += energy * 60 * dt
    setScore(Math.floor(scoreRef.current))
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
    radius: 20,
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
	// scoring + game state (MUST be before the audio effect below)
	const [score, setScore] = useState(0)
	const scoreRef = useRef(0)
	const [gameActive, setGameActive] = useState(false)

	// (optional) if you want autorotate to stop when game ends:
	const stopRotateOnEnd = true
	const [autoRotate, setAutoRotate] = useState(true)


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

	  // try immediate autoplay (works if muted)
	  a.play().catch(() => {})

	  // iOS/Safari need an AudioContext resume to allow sound
	  const AC = window.AudioContext || window.webkitAudioContext
	  const ctx = AC ? new AC() : null

	  const fadeIn = () => {
		// unmute + ramp volume up smoothly
		a.muted = false
		a.volume = Math.min(a.volume ?? 0, 0) // start at 0
		const step = () => {
		  a.volume = Math.min(1, a.volume + 0.08)
		  if (a.volume < 1) raf = requestAnimationFrame(step)
		}
		step()
	  }

	  let raf = 0
	  const unlock = () => {
		if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
		// ensure the element is playing
		a.play().catch(() => {})
		fadeIn()
		// remove listeners after first unlock
		window.removeEventListener('pointerdown', unlock)
		window.removeEventListener('touchstart', unlock)
		window.removeEventListener('keydown', unlock)
		document.removeEventListener('visibilitychange', onVis)
	  }

	  const onVis = () => {
		// sometimes coming back to a visible tab counts as activation
		if (document.visibilityState === 'visible') unlock()
	  }

	  window.addEventListener('pointerdown', unlock, { once: true })
	  window.addEventListener('touchstart', unlock, { once: true, passive: true })
	  window.addEventListener('keydown', unlock, { once: true })
	  document.addEventListener('visibilitychange', onVis)

	  return () => {
		cancelAnimationFrame(raf)
		window.removeEventListener('pointerdown', unlock)
		window.removeEventListener('touchstart', unlock)
		window.removeEventListener('keydown', unlock)
		document.removeEventListener('visibilitychange', onVis)
		// optional: ctx?.close()
	  }
	}, [])
	
	// start score on music start; freeze on end
	useEffect(() => {
	  const a = audioRef.current
	  if (!a) return

	  const onPlay = () => {
		// reset + start
		scoreRef.current = 0
		setScore(0)
		setGameActive(true)
		if (stopRotateOnEnd) setAutoRotate(true)
	  }

	  const onEnded = () => {
		// freeze score, stop reacting to motion
		setGameActive(false)
		if (stopRotateOnEnd) setAutoRotate(false)
	  }

	  a.addEventListener('play', onPlay)
	  a.addEventListener('ended', onEnded)
	  return () => {
		a.removeEventListener('play', onPlay)
		a.removeEventListener('ended', onEnded)
	  }
	}, [stopRotateOnEnd])



  const [motionValue, setMotionValue] = useState(0)
  
	// Map motionValue (unbounded) to a sane autoRotateSpeed
	const autoRotateSpeedFromMotion = React.useMemo(() => {
	  // 1) keep only positive values
	  const mv = Math.max(0, motionValue)

	  // 2) small dead-zone so tiny wiggles don't move camera
	  const DEAD = 20
	  const m = mv > DEAD ? (mv - DEAD) : 0

	  // 3) saturating curve: grows fast at first, then eases
	  //    tweak 0.85 and 0.35 to taste; clamp to avoid crazy speeds
	  const speed = 0.35 + Math.min(10, Math.log2(1 + m) * 0.85)

	  return speed
	}, [motionValue])  
	

  

  const [sky, setSky] = useState(defaultSky)
  const [env, setEnv] = useState(defaultEnv)
  const [coaster, setCoaster] = useState(defaultCoaster)
  const [rain, setRain] = useState(defaultRain)
  const [imgRing, setImgRing] = useState(defaultImgRing)
  

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

	// Start music & ensure camera rotates when movement is sustained
	const audioStartedRef = useRef(false)
	const mvSinceRef = useRef(0)
	


	const startMusicAndRotate = React.useCallback(() => {
	  if (audioStartedRef.current) return
	  const a = audioRef.current
	  if (!a) return

	  // make sure it's playing (it should be, muted)
	  a.play().catch(() => {})

	  // unmute + smooth fade-in
	  a.muted = false
	  a.volume = 0
	  let v = 0
	  const fade = () => {
		v = Math.min(1, v + 0.06)
		a.volume = v
		if (v < 1) requestAnimationFrame(fade)
	  }
	  requestAnimationFrame(fade)

	  // ensure autorotate is enabled
	  setAutoRotate(true)
	  audioStartedRef.current = true
	}, [])

	useEffect(() => {
	  // hysteresis so tiny wiggles don't trigger
	  const START_MV = 35         // tweak to taste
	  const HOLD_MS  = 250        // must stay above threshold this long

	  const now = performance.now()
	  if (motionValue > START_MV) {
		if (!mvSinceRef.current) mvSinceRef.current = now
		if (now - mvSinceRef.current > HOLD_MS) startMusicAndRotate()
	  } else {
		mvSinceRef.current = 0
	  }
	}, [motionValue, startMusicAndRotate])
	
// helpers (top-level or near where you compute dynamic values)
	const response = (mv, dead=20, sens=180) => {
	  const m = Math.max(0, mv - dead)
	  return 1 - Math.exp(-m / sens) // 0..1
	}
	
		// inside App() render, before return:
	const outerMountainRadius = React.useMemo(
	  () => env.baseRadius + (env.ringCount - 1) * env.ringSpacing,
	  [env.baseRadius, env.ringCount, env.ringSpacing]
	)

	// === Motion → Moon params ===
	const MOON_BASE = 5,  MOON_MAX = 8
	const SPIN_BASE = 0.1, SPIN_MAX = 0.8 // give yourself headroom

	const { dynamicMoonSize, dynamicRingSpin } = React.useMemo(() => {
	  const tSize = response(motionValue, 20, 260) // smoother size
	  const tSpin = response(motionValue, 20, 160) // snappier spin
	  return {
		dynamicMoonSize: THREE.MathUtils.lerp(MOON_BASE, MOON_MAX, tSize),
		dynamicRingSpin: THREE.MathUtils.lerp(SPIN_BASE, SPIN_MAX, tSpin),
	  }
	}, [motionValue])

	// === Motion → Rain (two-stage mapping) ===
	// tweakables
	const RAIN_MIN_COUNT = 120;
	const RAIN_MAX_COUNT = 800;
	const RAIN_MIN_OP = 0.16;
	const RAIN_MAX_OP = 0.75;
	const RAIN_SPLIT = 0.5;        // 0..1  →  % of "energy" spent on opacity before count
	const RAIN_SENS = 200;         // bigger = needs more motion to max out

	// reuse your response() helper to get a 0..1 "energy" from motionValue
	const tRain = React.useMemo(() => {
	  // deadzone 0 so even tiny movement grows a little (change if you want)
	  return 1 - Math.exp(-Math.max(0, motionValue) / RAIN_SENS);
	}, [motionValue]);

	let dynamicRainOpacity, dynamicRainCount;
	if (tRain <= RAIN_SPLIT) {
	  // Phase A: only opacity grows (count fixed at min)
	  const k = tRain / Math.max(1e-6, RAIN_SPLIT); // 0..1
	  dynamicRainOpacity = THREE.MathUtils.lerp(RAIN_MIN_OP, RAIN_MAX_OP, k);
	  dynamicRainCount   = RAIN_MIN_COUNT;
	} else {
	  // Phase B: opacity pinned max, count grows
	  const k = (tRain - RAIN_SPLIT) / Math.max(1e-6, (1 - RAIN_SPLIT)); // 0..1
	  dynamicRainOpacity = RAIN_MAX_OP;
	  dynamicRainCount   = Math.round(THREE.MathUtils.lerp(RAIN_MIN_COUNT, RAIN_MAX_COUNT, k));
	}
	
	const cloudImages = useMemo(() =>
	  Array.from({ length: 24 }, (_, i) => `${BASE}img/Cl${i + 1}.png`),
		[]
		)

		const cloudItems = [
		  { scale: [80, 20, 1], y: 100 },
		  { scale: [90, 20, 1], y: 100 },
		  { scale: [60, 20, 1], y: 70 },
		  { scale: [80, 20, 1], y: 80 },
		  { scale: [80, 20, 1], y: 100 },
		  { scale: [80, 20, 1], y: 90 },
		  { scale: [70, 20, 1], y: 100 },
		  { scale: [70, 20, 1], y: 70 },
		  { scale: [60, 20, 1], y: 100 },
		  { scale: [90, 20, 1], y: 80 },
		  { scale: [80, 20, 1], y: 100 },
		  { scale: [80, 20, 1], y: 70 },
		  { scale: [70, 20, 1], y: 90 },
		  { scale: [70, 20, 1], y: 80 },
		  { scale: [90, 20, 1], y: 110 },
		  { scale: [90, 20, 1], y: 70 },	
		  { scale: [70, 20, 1], y: 80 },
		  { scale: [90, 20, 1], y: 110 },
		  { scale: [90, 20, 1], y: 70 }	,	  
		  { scale: [80, 20, 1], y: 70 },
		  { scale: [70, 20, 1], y: 90 },
		  { scale: [70, 20, 1], y: 80 },
		  { scale: [90, 20, 1], y: 110 },
		  { scale: [90, 20, 1], y: 70 },	
		  { scale: [70, 20, 1], y: 80 },
		  { scale: [90, 20, 1], y: 110 },
		  { scale: [90, 20, 1], y: 70 }			  
		]
	


  return (
    <>
	{/* MediaPipe Pose movement detector */}
	<MotionDetector onChange={setMotionValue} />
	<div style={{
	  position: 'fixed',
	  top: 12,
	  left: 12,
	  background: 'rgba(0,0,0,0.55)',
	  color: '#ffe98a',
	  padding: '8px 10px',
	  borderRadius: 8,
	  fontFamily: 'monospace',
	  zIndex: 1000,
	  pointerEvents: 'none'
	}}>
	  <div>Score: {score}</div>
	  {!gameActive && <div style={{ color: '#aaa' }}>game over</div>}
	</div>


		<audio
		  ref={audioRef}
		  src={`${BASE}FunnyHalloween.mp3`}
		  preload="auto"
		  autoPlay
		  playsInline
		  muted
		/>


      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 2, 0], fov: 60, near: 0.1, far: 4000 }}
        gl={{ antialias: true, alpha: false }}
      >
        <ambientLight intensity={0.2} />
		<ScoreTicker
		   gameActive={gameActive}
		   motionValue={motionValue}
		   scoreRef={scoreRef}
		   setScore={setScore}
		 />

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
		 <LightningClassic
			enabled
			color="#ffffff"
			cloudY={20}
			cloudRadius={40}
			minDelay={0.06}
			maxDelay={0.08}
			minDur={0.18}
			maxDur={0.36}
			minVerticality={0.98}
			minHeight={12}
			maxHeight={18}
			lateralJitter={0.05}
			power={8}
			flashPower={1200}
			seed={1337}
		  />

		<Rain
		  enabled={rain.enabled}
		  count={dynamicRainCount}      // ⟵ wired
		  areaRadius={rain.areaRadius}
		  areaHeight={rain.areaHeight}
		  groundY={env.yBase}
		  speed={rain.speed}
		  length={rain.length}
		  windX={rain.windX}
		  windZ={rain.windZ}
		  color={rain.color}
		  opacity={dynamicRainOpacity}  // ⟵ wired
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
          <MoonSystem 
			moonSize={dynamicMoonSize}
			ringSpinSpeed={dynamicRingSpin}
			compensateCamera
			cameraCompFactor={1}
		  />
		  
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
			<BatsJumpHtml
			  gifUrl={`${BASE}img/bat.gif`}
			  count={8}
			  radius={outerMountainRadius}  // ⟵ stays on the mountains ring
			  baseY={18}
			  pixelWidth={240}
			  motion={motionValue}          // ⟵ wire your movement metric
			  dead={20}
			  sens={220}
			  maxJump={8}
			  wobbleAmp={0.6}
			  wobbleFreq={2.0}
			  spinSpeed={0.04}              // or 0 to disable ring spin
			  smooth={0.28}
			/>
			<ImageRing
			  enabled
			  images={cloudImages}
			  radius={240}        // distance from center
			  y={56}             // default Y (overridden per-item)
			  size={12}          // default size (overridden per-item)
			  items={cloudItems} // per-image overrides
			  mode="billboard"
			  opacity={0.88}
			/>
        </Suspense>

        <OrbitControls
		  enableZoom={false}
		  enablePan={false}
		  enableDamping
		  dampingFactor={0.1}
		  autoRotate={autoRotate}
		  autoRotateSpeed={autoRotateSpeedFromMotion} 

		  // NEW: look straight ahead from y=2
		  target={[1, 2.1, 0]}
		  // NEW: keep horizon (no looking down/up)
			minPolarAngle={Math.PI * 0.3}  
			maxPolarAngle={Math.PI * 1.6}  
        />
      </Canvas>
    </>
  )
}
