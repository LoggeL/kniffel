"use client";

import { RoundedBox } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { playDiceLand, playDiceRoll } from "@/lib/sounds";

export interface DiceBoxProps {
  dice: number[];
  held: boolean[];
  disabled: boolean;
  rollSequence: number;
  onToggleHold: (index: number) => void;
}

interface DieState {
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  targetQuaternion: THREE.Quaternion;
  rolling: boolean;
  settling: boolean;
  settled: boolean;
  dotReveal: number; // 0 = hidden, 1 = fully revealed
  landSoundPlayed: boolean;
}

type Vec3 = [number, number, number];

const DICE_SIZE = 0.86;
const DICE_HALF = DICE_SIZE / 2;
const SURFACE_WIDTH = 7.9;
const SURFACE_DEPTH = 4.8;
const AIR_HEIGHT = 3.5;
const DICE_COLLISION_DISTANCE = DICE_SIZE * 0.95;
const DICE_COLLISION_DISTANCE_SQ = DICE_COLLISION_DISTANCE * DICE_COLLISION_DISTANCE;
const COLLISION_RESTITUTION = 0.55;
const WALL_RESTITUTION = 0.5;
const FLOOR_RESTITUTION = 0.38;
const GRAVITY = -22.0;
const LINEAR_DAMPING = 1.8;
const ANGULAR_DAMPING = 3.2;
const FLOOR_FRICTION = 0.88;

const FACE_DOTS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, 1],
    [1, -1],
  ],
  3: [
    [-1, 1],
    [0, 0],
    [1, -1],
  ],
  4: [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ],
  5: [
    [-1, 1],
    [1, 1],
    [0, 0],
    [-1, -1],
    [1, -1],
  ],
  6: [
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [1, 1],
    [1, 0],
    [1, -1],
  ],
};

const FACE_LAYOUT: { value: number; position: Vec3; rotation: Vec3 }[] = [
  { value: 3, position: [DICE_HALF + 0.002, 0, 0], rotation: [0, Math.PI / 2, 0] },
  { value: 4, position: [-DICE_HALF - 0.002, 0, 0], rotation: [0, -Math.PI / 2, 0] },
  { value: 1, position: [0, DICE_HALF + 0.002, 0], rotation: [-Math.PI / 2, 0, 0] },
  { value: 6, position: [0, -DICE_HALF - 0.002, 0], rotation: [Math.PI / 2, 0, 0] },
  { value: 2, position: [0, 0, DICE_HALF + 0.002], rotation: [0, 0, 0] },
  { value: 5, position: [0, 0, -DICE_HALF - 0.002], rotation: [0, Math.PI, 0] },
];

const tempEuler = new THREE.Euler();
const tempQuat = new THREE.Quaternion();
const collisionNormal = new THREE.Vector3();
const relativeVelocityVector = new THREE.Vector3();
const collisionSpinAxis = new THREE.Vector3();

function clampDiceValue(value: number): number {
  if (value < 1 || value > 6) return 1;
  return value;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function getTargetQuaternion(value: number): THREE.Quaternion {
  const q = new THREE.Quaternion();
  switch (clampDiceValue(value)) {
    case 1: q.identity(); break;
    case 2: q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)); break;
    case 3: q.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)); break;
    case 4: q.setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2)); break;
    case 5: q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)); break;
    case 6: q.setFromEuler(new THREE.Euler(Math.PI, 0, 0)); break;
    default: q.identity(); break;
  }
  return q;
}

function buildRestPositions(count: number): Vec3[] {
  if (count <= 1) return [[0, DICE_HALF, 0]];
  const left = -SURFACE_WIDTH / 2 + DICE_HALF + 0.35;
  const right = SURFACE_WIDTH / 2 - DICE_HALF - 0.35;
  const step = (right - left) / (count - 1);
  return Array.from({ length: count }, (_, i) => [left + step * i, DICE_HALF, 0]);
}

function DotFace({
  value,
  position,
  rotation,
  held,
  reveal,
}: {
  value: number;
  position: Vec3;
  rotation: Vec3;
  held: boolean;
  reveal: number;
}) {
  const faceSize = DICE_SIZE * 0.78;
  const spread = faceSize * 0.27;
  const dotRadius = DICE_SIZE * 0.065;
  const dotDepth = DICE_SIZE * 0.025;
  const dots = FACE_DOTS[value] || FACE_DOTS[1];
  const dotColor = held ? "#0f3060" : "#1a2e4a";
  const shadowColor = "#0a1a30";

  return (
    <group position={position} rotation={rotation}>
      <mesh receiveShadow>
        <planeGeometry args={[faceSize, faceSize]} />
        <meshStandardMaterial
          color={held ? "#dbe8ff" : "#fbfcff"}
          roughness={0.35}
          metalness={0.02}
          transparent
          opacity={0.96}
        />
      </mesh>

      {dots.map(([x, y], i) => (
        <group key={`${value}-${i}`} position={[x * spread, y * spread, 0]}>
          {/* Indented shadow / cavity */}
          <mesh position={[0, 0, dotDepth * 0.2]}>
            <circleGeometry args={[dotRadius * 1.15, 24]} />
            <meshStandardMaterial
              color={shadowColor}
              roughness={0.8}
              transparent
              opacity={0.3 * reveal}
            />
          </mesh>
          {/* Main dot - slightly recessed */}
          <mesh position={[0, 0, dotDepth * 0.5]}>
            <cylinderGeometry args={[dotRadius * reveal, dotRadius * reveal, dotDepth * 2, 24]} />
            <meshStandardMaterial
              color={dotColor}
              roughness={0.25}
              metalness={0.08}
              transparent
              opacity={reveal}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function DiceMesh({
  dieRef,
  index,
  held,
  disabled,
  reveal,
  onToggleHold,
}: {
  dieRef: (node: THREE.Group | null) => void;
  index: number;
  held: boolean;
  disabled: boolean;
  reveal: number;
  onToggleHold: (index: number) => void;
}) {
  return (
    <group
      ref={dieRef}
      onPointerOver={() => {
        if (!disabled) document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "default";
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!disabled) onToggleHold(index);
      }}
    >
      <RoundedBox
        args={[DICE_SIZE, DICE_SIZE, DICE_SIZE]}
        radius={0.1}
        smoothness={6}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color={held ? "#d4e5ff" : "#f6f9ff"}
          roughness={0.22}
          metalness={0.03}
          clearcoat={0.4}
          clearcoatRoughness={0.15}
          emissive={held ? "#2b5aa4" : "#000000"}
          emissiveIntensity={held ? 0.28 : 0}
        />
      </RoundedBox>

      {FACE_LAYOUT.map((face) => (
        <DotFace
          key={`die-${index}-face-${face.value}`}
          value={face.value}
          position={face.position}
          rotation={face.rotation}
          held={held}
          reveal={reveal}
        />
      ))}
    </group>
  );
}

function DiceScene({
  dice,
  held,
  disabled,
  rollSequence,
  onToggleHold,
  onSettled,
}: DiceBoxProps & { onSettled: (settled: boolean[]) => void }) {
  const count = dice.length;
  const restPositions = useMemo(() => buildRestPositions(count), [count]);

  const dieRefs = useRef<(THREE.Group | null)[]>([]);
  const stateRef = useRef<DieState[]>([]);
  const previousRollSequenceRef = useRef(rollSequence);
  const initializedRef = useRef(false);
  const revealRef = useRef<number[]>(new Array(5).fill(1));
  const rollSoundPlayedRef = useRef(false);

  useEffect(() => {
    dieRefs.current = Array.from({ length: count }, (_, i) => dieRefs.current[i] || null);
    stateRef.current = Array.from({ length: count }, (_, i) => {
      const existing = stateRef.current[i];
      if (existing) {
        existing.targetQuaternion = getTargetQuaternion(dice[i]);
        return existing;
      }
      return {
        velocity: new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
        targetQuaternion: getTargetQuaternion(dice[i]),
        rolling: false,
        settling: true,
        settled: false,
        dotReveal: 1,
        landSoundPlayed: true,
      };
    });
  }, [count, dice]);

  useEffect(() => {
    for (let i = 0; i < count; i++) {
      const state = stateRef.current[i];
      if (!state) continue;
      state.targetQuaternion = getTargetQuaternion(dice[i]);
      if (!state.rolling) state.settling = true;
    }
  }, [count, dice]);

  useEffect(() => {
    if (rollSequence === previousRollSequenceRef.current) return;
    previousRollSequenceRef.current = rollSequence;
    rollSoundPlayedRef.current = false;

    const xMin = -SURFACE_WIDTH / 2 + DICE_HALF + 0.15;
    const xMax = SURFACE_WIDTH / 2 - DICE_HALF - 0.15;
    const zMin = -SURFACE_DEPTH / 2 + DICE_HALF + 0.15;
    const zMax = SURFACE_DEPTH / 2 - DICE_HALF - 0.15;

    let anyRolling = false;

    for (let i = 0; i < count; i++) {
      const die = dieRefs.current[i];
      const state = stateRef.current[i];
      if (!die || !state) continue;
      state.targetQuaternion = getTargetQuaternion(dice[i]);

      if (held[i]) {
        state.velocity.set(0, 0, 0);
        state.angularVelocity.set(0, 0, 0);
        state.rolling = false;
        state.settling = true;
        continue;
      }

      die.position.set(
        randomBetween(xMin, xMax),
        randomBetween(DICE_HALF + 1.2, AIR_HEIGHT - DICE_HALF - 0.3),
        randomBetween(zMin, zMax)
      );

      state.velocity.set(
        randomBetween(-5.5, 5.5),
        randomBetween(5.5, 9.0),
        randomBetween(-4.5, 4.5)
      );
      state.angularVelocity.set(
        randomBetween(-16, 16),
        randomBetween(-16, 16),
        randomBetween(-16, 16)
      );
      state.rolling = true;
      state.settling = false;
      state.settled = false;
      state.dotReveal = 0;
      state.landSoundPlayed = false;
      anyRolling = true;
    }

    if (anyRolling) playDiceRoll();
  }, [count, dice, held, rollSequence]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);

    // Physics step
    for (let i = 0; i < count; i++) {
      const die = dieRefs.current[i];
      const state = stateRef.current[i];
      if (!die || !state) continue;

      if (!initializedRef.current) {
        const [x, y, z] = restPositions[i] || [0, DICE_HALF, 0];
        die.position.set(x, y, z);
        die.quaternion.copy(state.targetQuaternion);
      }

      if (state.rolling) {
        // Gravity
        state.velocity.y += GRAVITY * dt;
        die.position.addScaledVector(state.velocity, dt);

        // Rotation
        tempEuler.set(
          state.angularVelocity.x * dt,
          state.angularVelocity.y * dt,
          state.angularVelocity.z * dt,
          "XYZ"
        );
        tempQuat.setFromEuler(tempEuler);
        die.quaternion.multiply(tempQuat).normalize();

        const xLimit = SURFACE_WIDTH / 2 - DICE_HALF;
        const zLimit = SURFACE_DEPTH / 2 - DICE_HALF;
        const yFloor = DICE_HALF;
        const yCeiling = AIR_HEIGHT - DICE_HALF;

        // Wall collisions with friction
        if (die.position.x < -xLimit) {
          die.position.x = -xLimit;
          state.velocity.x = Math.abs(state.velocity.x) * WALL_RESTITUTION;
          state.velocity.z *= 0.92;
          state.angularVelocity.y *= -0.6;
        } else if (die.position.x > xLimit) {
          die.position.x = xLimit;
          state.velocity.x = -Math.abs(state.velocity.x) * WALL_RESTITUTION;
          state.velocity.z *= 0.92;
          state.angularVelocity.y *= -0.6;
        }

        if (die.position.z < -zLimit) {
          die.position.z = -zLimit;
          state.velocity.z = Math.abs(state.velocity.z) * WALL_RESTITUTION;
          state.velocity.x *= 0.92;
          state.angularVelocity.x *= -0.6;
        } else if (die.position.z > zLimit) {
          die.position.z = zLimit;
          state.velocity.z = -Math.abs(state.velocity.z) * WALL_RESTITUTION;
          state.velocity.x *= 0.92;
          state.angularVelocity.x *= -0.6;
        }

        // Floor collision with bounce and friction
        if (die.position.y < yFloor) {
          die.position.y = yFloor;
          const impactSpeed = Math.abs(state.velocity.y);
          state.velocity.y = impactSpeed * FLOOR_RESTITUTION;
          // Floor friction reduces horizontal velocity
          state.velocity.x *= FLOOR_FRICTION;
          state.velocity.z *= FLOOR_FRICTION;
          // Transfer some linear to angular velocity on bounce
          state.angularVelocity.x += state.velocity.z * 1.2;
          state.angularVelocity.z -= state.velocity.x * 1.2;
          // Small bounces just stop vertically
          if (impactSpeed < 0.8) {
            state.velocity.y = 0;
          }
        } else if (die.position.y > yCeiling) {
          die.position.y = yCeiling;
          state.velocity.y = -Math.abs(state.velocity.y) * 0.35;
        }

        // Air/surface damping
        state.velocity.multiplyScalar(Math.exp(-LINEAR_DAMPING * dt));
        state.angularVelocity.multiplyScalar(Math.exp(-ANGULAR_DAMPING * dt));

        // Check if settled
        if (
          die.position.y <= yFloor + 0.015 &&
          state.velocity.lengthSq() < 0.08 &&
          state.angularVelocity.lengthSq() < 0.1
        ) {
          state.velocity.set(0, 0, 0);
          state.angularVelocity.set(0, 0, 0);
          state.rolling = false;
          state.settling = true;
          if (!state.landSoundPlayed) {
            state.landSoundPlayed = true;
            playDiceLand();
          }
        }
      }
    }

    // Dice-to-dice collisions
    for (let a = 0; a < count; a++) {
      const dieA = dieRefs.current[a];
      const stateA = stateRef.current[a];
      if (!dieA || !stateA) continue;

      for (let b = a + 1; b < count; b++) {
        const dieB = dieRefs.current[b];
        const stateB = stateRef.current[b];
        if (!dieB || !stateB) continue;

        collisionNormal.subVectors(dieB.position, dieA.position);
        const distSq = collisionNormal.lengthSq();
        if (distSq <= 0 || distSq >= DICE_COLLISION_DISTANCE_SQ) continue;

        const dist = Math.sqrt(distSq);
        collisionNormal.multiplyScalar(1 / Math.max(dist, 1e-4));
        const overlap = DICE_COLLISION_DISTANCE - dist + 0.002;

        const aLocked = Boolean(held[a] && !stateA.rolling);
        const bLocked = Boolean(held[b] && !stateB.rolling);

        if (aLocked && bLocked) continue;

        // Separate overlapping dice
        if (aLocked) {
          dieB.position.addScaledVector(collisionNormal, overlap);
        } else if (bLocked) {
          dieA.position.addScaledVector(collisionNormal, -overlap);
        } else {
          dieA.position.addScaledVector(collisionNormal, -overlap * 0.5);
          dieB.position.addScaledVector(collisionNormal, overlap * 0.5);
        }

        // Impulse-based collision response
        if (aLocked) {
          const vn = stateB.velocity.dot(collisionNormal);
          if (vn < 0) {
            stateB.velocity.addScaledVector(collisionNormal, -(1 + COLLISION_RESTITUTION) * vn);
          }
        } else if (bLocked) {
          const vn = stateA.velocity.dot(collisionNormal);
          if (vn > 0) {
            stateA.velocity.addScaledVector(collisionNormal, -(1 + COLLISION_RESTITUTION) * vn);
          }
        } else {
          relativeVelocityVector.subVectors(stateB.velocity, stateA.velocity);
          const rvn = relativeVelocityVector.dot(collisionNormal);
          if (rvn < 0) {
            const impulse = (-(1 + COLLISION_RESTITUTION) * rvn) / 2;
            stateA.velocity.addScaledVector(collisionNormal, -impulse);
            stateB.velocity.addScaledVector(collisionNormal, impulse);
          }
        }

        // Angular impulse from collision
        collisionSpinAxis.set(collisionNormal.z, 0.35, -collisionNormal.x).normalize();
        const spinStrength = 3.0;
        if (!aLocked) {
          stateA.angularVelocity.addScaledVector(collisionSpinAxis, -spinStrength);
          if (!stateA.rolling) {
            stateA.rolling = true;
            stateA.settling = false;
          }
        }
        if (!bLocked) {
          stateB.angularVelocity.addScaledVector(collisionSpinAxis, spinStrength);
          if (!stateB.rolling) {
            stateB.rolling = true;
            stateB.settling = false;
          }
        }
      }
    }

    // Settling & dot reveal
    const settledArr: boolean[] = [];
    for (let i = 0; i < count; i++) {
      const die = dieRefs.current[i];
      const state = stateRef.current[i];
      if (!die || !state) {
        settledArr.push(true);
        continue;
      }

      if (state.rolling) {
        // While rolling, dots are hidden
        state.dotReveal = 0;
        settledArr.push(false);
        continue;
      }

      if (state.settling) {
        const settleAmount = 1 - Math.exp(-10 * dt);
        die.quaternion.slerp(state.targetQuaternion, settleAmount);
        die.position.y = THREE.MathUtils.lerp(die.position.y, DICE_HALF, settleAmount);

        if (die.quaternion.angleTo(state.targetQuaternion) < 0.014) {
          die.quaternion.copy(state.targetQuaternion);
          state.settling = false;
          state.settled = true;
        }
      }

      // Animate dot reveal after settling
      if (!state.rolling && !state.settling) {
        state.dotReveal = Math.min(1, state.dotReveal + dt * 4.5);
      } else if (state.settling) {
        state.dotReveal = Math.min(1, state.dotReveal + dt * 3.0);
      }

      revealRef.current[i] = state.dotReveal;
      settledArr.push(state.dotReveal >= 0.95);
    }

    // Notify parent about settled state
    onSettled(settledArr);

    initializedRef.current = true;
  });

  return (
    <>
      <ambientLight intensity={0.88} />
      <directionalLight
        position={[4.8, 8.4, 2.8]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1536}
        shadow-mapSize-height={1536}
        shadow-bias={-0.00025}
        shadow-radius={7}
      />
      <pointLight position={[-3.8, 2.9, -1.8]} intensity={0.42} color="#b6c8e8" />
      <pointLight position={[2.5, 4.0, 3.0]} intensity={0.18} color="#ffe8c0" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[SURFACE_WIDTH + 2.4, SURFACE_DEPTH + 2.2]} />
        <shadowMaterial transparent opacity={0.2} />
      </mesh>

      {restPositions.map((_, index) => (
        <DiceMesh
          key={index}
          dieRef={(node) => { dieRefs.current[index] = node; }}
          index={index}
          held={Boolean(held[index])}
          disabled={disabled}
          reveal={revealRef.current[index] ?? 1}
          onToggleHold={onToggleHold}
        />
      ))}
    </>
  );
}

export function DiceBox({ dice, held, disabled, rollSequence, onToggleHold }: DiceBoxProps) {
  const [diceSettled, setDiceSettled] = useState<boolean[]>([true, true, true, true, true]);
  const prevSettledRef = useRef<string>("11111");

  const handleSettled = useCallback((settled: boolean[]) => {
    const key = settled.map((s) => (s ? "1" : "0")).join("");
    if (key !== prevSettledRef.current) {
      prevSettledRef.current = key;
      setDiceSettled([...settled]);
    }
  }, []);

  return (
    <div className="mt-4 rounded-[24px] border-2 border-[#2a4f89]/55 bg-[#f8eed8]/85 px-2 pb-3 pt-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_18px_40px_-30px_rgba(24,58,116,0.85)] sm:px-4">
      <div className="h-56 w-full sm:h-64 lg:h-72">
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [0, 6.7, 5.7], fov: 33, near: 0.1, far: 50 }}
          gl={{ antialias: true, alpha: true }}
        >
          <DiceScene
            dice={dice}
            held={held}
            disabled={disabled}
            rollSequence={rollSequence}
            onToggleHold={onToggleHold}
            onSettled={handleSettled}
          />
        </Canvas>
      </div>

      <div className="mt-1 flex justify-center">
        <div
          className="grid w-full max-w-3xl gap-2 sm:gap-3"
          style={{
            gridTemplateColumns: `repeat(${Math.max(dice.length, 1)}, minmax(0, 1fr))`,
          }}
        >
          {dice.map((value, index) => {
            const isSettled = diceSettled[index] ?? true;
            return (
              <div
                key={`die-control-${index}`}
                className="flex flex-col items-center justify-center gap-1 rounded-md border border-[#2a4f89]/35 bg-[#f2e6cc]/70 px-1 py-2 text-[#17407b]"
              >
                <label className="flex items-center gap-1 text-[11px] uppercase tracking-[0.11em]">
                  <input
                    type="checkbox"
                    checked={Boolean(held[index])}
                    onChange={() => onToggleHold(index)}
                    disabled={disabled}
                    className="h-3.5 w-3.5 accent-[#1f4d90]"
                  />
                  Halt
                </label>
                <span className="text-xs text-[#2a4f89]/70">Augen</span>
                <span
                  className="font-mono text-xl font-bold leading-none transition-all duration-300"
                  style={{
                    color: isSettled ? "#123f84" : "transparent",
                    textShadow: isSettled ? "none" : "0 0 8px rgba(18,63,132,0.4)",
                  }}
                >
                  {isSettled ? clampDiceValue(value) : "?"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
