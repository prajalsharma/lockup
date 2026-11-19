"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Lot } from "@/lib/yard/types";
import { crateTexture, fontsReady, numberTexture, tagTexture } from "./textures";

const W = 3;
const H = 3.4;
const TAGS: [number, number, number][] = [
  [-0.82, 2.78, -0.07],
  [0.86, 1.42, 0.05],
  [-0.7, 0.72, 0.04],
];
const NUMBER_SPOT: [number, number] = [0, 2.02];

export interface DoorSceneProps {
  unit: number;
  paint?: string;
  clues: string[];
  /** Indexes of clues already found; found tags stay lit. */
  found: boolean[];
  onFound?: (index: number) => void;
  open: boolean;
  contents?: Lot[] | null;
  /** Play the scripted torch sweep once on mount. */
  attract?: boolean;
  active: boolean;
  reduced: boolean;
  pointer: React.RefObject<{ x: number; y: number; inside: boolean }>;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function Rig() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / size.height;
    const vFov = (cam.fov * Math.PI) / 180;
    const fitH = (H + 1.25) / (2 * Math.tan(vFov / 2));
    const fitW = (W + 0.7) / (2 * Math.tan(vFov / 2) * aspect);
    cam.position.set(0, H / 2 + 0.15, Math.max(fitH, fitW));
    cam.lookAt(0, H / 2 + 0.15, 0);
    cam.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

function Scene({ unit, paint = "#4d5560", clues, found, onFound, open, contents, attract, reduced, pointer }: DoorSceneProps) {
  const { camera, gl } = useThree();
  const [fonts, setFonts] = useState<{ anton: string; mono: string } | null>(null);
  useEffect(() => {
    gl.localClippingEnabled = true;
    let live = true;
    void fontsReady().then((f) => live && setFonts(f));
    return () => { live = false; };
  }, [gl]);

  const clip = useMemo(() => [new THREE.Plane(new THREE.Vector3(0, -1, 0), H)], []);

  const doorGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(W, H, 1, 136);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setZ(i, Math.sin((y / H) * Math.PI * 2 * 17) * 0.04);
    }
    g.computeVertexNormals();
    return g;
  }, []);

  const numTex = useMemo(() => (fonts ? numberTexture(unit, fonts.anton) : null), [fonts, unit]);
  const tagTex = useMemo(() => (fonts ? clues.slice(0, 3).map((c, i) => tagTexture(c, i, fonts.mono)) : []), [fonts, clues]);
  const crates = useMemo(() => {
    if (!fonts || !contents) return [];
    return contents.slice(0, 6).map((l, i) => {
      const s = l.item.heavy ? 1.12 : l.item.rarity === "common" ? 0.74 : 0.88;
      const col = i % 3, row = Math.floor(i / 3);
      return {
        key: l.item.id, size: s,
        pos: [(col - 1) * 0.98 + (row ? 0.34 : 0), s / 2, -0.8 - row * 1.15] as [number, number, number],
        rot: ((i * 37) % 11 - 5) * 0.035,
        tex: crateTexture(l.item.name, l.qty, l.item.rarity, fonts.mono),
        grail: l.item.rarity === "grail",
      };
    });
  }, [fonts, contents]);
  useEffect(() => () => { numTex?.dispose(); }, [numTex]);
  useEffect(() => () => { tagTex.forEach((t) => t.dispose()); }, [tagTex]);
  useEffect(() => () => { crates.forEach((c) => c.tex.dispose()); }, [crates]);

  const door = useRef<THREE.Group>(null);
  const lock = useRef<THREE.Group>(null);
  const torch = useRef<THREE.SpotLight>(null);
  const inside = useRef<THREE.PointLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const aim = useRef(new THREE.Vector3(NUMBER_SPOT[0], NUMBER_SPOT[1], 0));
  const progress = useRef(open && reduced ? 1 : 0);
  const dwell = useRef([0, 0, 0]);
  const sweep = useRef(attract && !reduced ? 0 : 99);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    // Door travel.
    const goal = open ? 1 : 0;
    if (reduced) progress.current = goal;
    else progress.current += Math.sign(goal - progress.current) * Math.min(Math.abs(goal - progress.current), dt / 2.4);
    const p = progress.current;
    const lift = easeInOut(Math.max(0, (p - 0.14) / 0.86));
    if (door.current) {
      door.current.position.y = lift * (H - 0.2);
      door.current.position.x = p > 0.14 && p < 1 ? Math.sin(p * 90) * 0.006 : 0;
    }
    if (lock.current) {
      const f = Math.min(1, p / 0.14);
      lock.current.position.y = 0.3 - f * f * 0.34;
      lock.current.rotation.z = f * 1.2;
      lock.current.visible = p < 0.16;
    }
    if (inside.current) inside.current.intensity = lift * 26;

    // Torch aim: scripted sweep first, then the pointer.
    const want = aim.current;
    if (sweep.current < 3.4) {
      sweep.current += dt;
      const t = sweep.current;
      const stops: [number, number][] = [[-1.6, 3.2], [TAGS[0][0], TAGS[0][1]], [TAGS[1][0], TAGS[1][1]], [TAGS[2][0], TAGS[2][1]], NUMBER_SPOT];
      const seg = Math.min(stops.length - 2, Math.floor(t / 0.85));
      const k = easeInOut(Math.min(1, (t - seg * 0.85) / 0.85));
      want.set(stops[seg][0] + (stops[seg + 1][0] - stops[seg][0]) * k, stops[seg][1] + (stops[seg + 1][1] - stops[seg][1]) * k, 0);
      target.position.copy(want);
    } else {
      const ptr = pointer.current;
      if (ptr && ptr.inside) {
        ndc.set(ptr.x, ptr.y);
        ray.setFromCamera(ndc, camera);
        if (ray.ray.intersectPlane(plane, hit)) want.copy(hit);
      }
      target.position.lerp(want, reduced ? 1 : 1 - Math.pow(0.0006, dt));
    }
    target.updateMatrixWorld();

    // A clue is found when the beam rests on its tag.
    if (p < 0.05 && onFound) {
      for (let i = 0; i < Math.min(3, clues.length); i++) {
        if (found[i]) continue;
        const d = Math.hypot(target.position.x - TAGS[i][0], target.position.y - TAGS[i][1]);
        dwell.current[i] = d < 0.5 ? dwell.current[i] + dt : 0;
        if (dwell.current[i] > 0.28) { dwell.current[i] = 0; onFound(i); }
      }
    }
  });

  const steel = "#30343a";
  return (
    <>
      <Rig />
      <color attach="background" args={["#07080a"]} />
      <hemisphereLight args={["#8fa0c8", "#2a1c08", 0.55]} />
      {/* Sodium yard lamp, off to the left. */}
      <directionalLight position={[-5, 6, 4]} intensity={1.15} color="#ffb45a" />
      <primitive object={target} />
      <spotLight ref={torch} position={[0.5, 1.5, 6]} target={target} angle={0.27} penumbra={0.8} intensity={105} distance={16} decay={1.6} color="#fff1d6" />

      {/* Wall around the doorway */}
      <mesh position={[-(W / 2 + 2), H / 2 + 0.6, 0]}><boxGeometry args={[4, H + 3, 0.3]} /><meshStandardMaterial color="#26282c" roughness={0.96} /></mesh>
      <mesh position={[W / 2 + 2, H / 2 + 0.6, 0]}><boxGeometry args={[4, H + 3, 0.3]} /><meshStandardMaterial color="#26282c" roughness={0.96} /></mesh>
      <mesh position={[0, H + 1.5, 0]}><boxGeometry args={[W, 3, 0.3]} /><meshStandardMaterial color="#26282c" roughness={0.96} /></mesh>
      {/* Frame and drum housing */}
      <mesh position={[-(W / 2 + 0.06), H / 2, 0.16]}><boxGeometry args={[0.12, H, 0.1]} /><meshStandardMaterial color={steel} metalness={0.7} roughness={0.45} /></mesh>
      <mesh position={[W / 2 + 0.06, H / 2, 0.16]}><boxGeometry args={[0.12, H, 0.1]} /><meshStandardMaterial color={steel} metalness={0.7} roughness={0.45} /></mesh>
      <mesh position={[0, H + 0.2, 0.2]}><boxGeometry args={[W + 0.5, 0.4, 0.34]} /><meshStandardMaterial color={steel} metalness={0.7} roughness={0.4} /></mesh>
      {/* Yard floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 3]}><planeGeometry args={[14, 8]} /><meshStandardMaterial color="#17181b" roughness={0.9} /></mesh>
      {/* Hazard strip on the threshold */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0.32]}><planeGeometry args={[W, 0.12]} /><meshStandardMaterial color="#ffb01f" roughness={0.7} /></mesh>

      {/* Inside the unit */}
      <group>
        <mesh position={[0, H / 2, -2.7]}><planeGeometry args={[W, H]} /><meshStandardMaterial color="#3a3026" roughness={0.95} /></mesh>
        <mesh position={[-W / 2, H / 2, -1.4]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[2.7, H]} /><meshStandardMaterial color="#332a21" roughness={0.95} /></mesh>
        <mesh position={[W / 2, H / 2, -1.4]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[2.7, H]} /><meshStandardMaterial color="#332a21" roughness={0.95} /></mesh>
        <mesh position={[0, 0.002, -1.4]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[W, 2.7]} /><meshStandardMaterial color="#2a241d" roughness={0.9} /></mesh>
        <pointLight ref={inside} position={[0, H - 0.5, -1]} intensity={0} distance={9} decay={1.7} color="#ffb45a" />
        {crates.map((c) => (
          <group key={c.key} position={c.pos} rotation={[0, c.rot, 0]}>
            <mesh><boxGeometry args={[c.size, c.size, c.size]} /><meshStandardMaterial color="#6d5a3c" roughness={0.85} /></mesh>
            <mesh position={[0, 0, c.size / 2 + 0.004]}>
              <planeGeometry args={[c.size * 0.86, c.size * 0.86]} />
              <meshStandardMaterial map={c.tex} roughness={0.8} emissive={c.grail ? "#ffb01f" : "#000000"} emissiveMap={c.grail ? c.tex : null} emissiveIntensity={c.grail ? 0.5 : 0} />
            </mesh>
          </group>
        ))}
      </group>

      {/* The door */}
      <group ref={door}>
        <mesh geometry={doorGeo} position={[0, H / 2, 0.02]}>
          <meshStandardMaterial color={paint} metalness={0.22} roughness={0.6} clippingPlanes={clip} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.07, 0.07]}><boxGeometry args={[W, 0.14, 0.09]} /><meshStandardMaterial color={steel} metalness={0.7} roughness={0.4} clippingPlanes={clip} /></mesh>
        {numTex && (
          <mesh position={[NUMBER_SPOT[0], NUMBER_SPOT[1], 0.075]}>
            <planeGeometry args={[1.9, 1.19]} />
            <meshStandardMaterial map={numTex} transparent roughness={0.9} clippingPlanes={clip} depthWrite={false} />
          </mesh>
        )}
        {tagTex.map((t, i) => (
          <mesh key={i} position={[TAGS[i][0], TAGS[i][1], 0.09]} rotation={[0, 0, TAGS[i][2]]}>
            <planeGeometry args={[1.02, 0.51]} />
            <meshStandardMaterial map={t} roughness={0.85} clippingPlanes={clip} emissive="#ffffff" emissiveMap={t} emissiveIntensity={found[i] ? 0.42 : 0} />
          </mesh>
        ))}
        <group ref={lock} position={[0, 0.3, 0.13]}>
          <mesh><boxGeometry args={[0.2, 0.16, 0.07]} /><meshStandardMaterial color="#c9973a" metalness={0.85} roughness={0.3} /></mesh>
          <mesh position={[0, 0.1, 0]}><torusGeometry args={[0.062, 0.017, 10, 20, Math.PI]} /><meshStandardMaterial color="#9aa0a8" metalness={0.9} roughness={0.25} /></mesh>
        </group>
      </group>
    </>
  );
}

export default function DoorScene(props: DoorSceneProps) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={props.active ? "always" : "never"}
      camera={{ fov: 34, near: 0.1, far: 60 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ touchAction: "pan-y" }}
    >
      <Scene {...props} />
    </Canvas>
  );
}
