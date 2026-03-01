"use client";

import { RoundedBox } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

interface DiceBoxProps {
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
}

type Vec3 = [number, number, number];

const DICE_SIZE = 0.86;
const DICE_HALF = DICE_SIZE / 2;
const SURFACE_WIDTH = 7.9;
const SURFACE_DEPTH = 4.8;
const AIR_HEIGHT = 3.5;
const DICE_COLLISION_DISTANCE = DICE_SIZE * 0.93;
const DICE_COLLISION_DISTANCE_SQ = DICE_COLLISION_DISTANCE * DICE_COLLISION_DISTANCE;
const COLLISION_RESTITUTION = 0.62;
const WALL_RESTITUTION = 0.64;
const FLOOR_RESTITUTION = 0.46;

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
  if (value < 1 || value > 6) {
    return 1;
  }
  return value;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function getTargetQuaternion(value: number): THREE.Quaternion {
  const q = new THREE.Quaternion();

  switch (clampDiceValue(value)) {
    case 1:
      q.identity();
      break;
    case 2:
      q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      break;
    case 3:
      q.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
      break;
    case 4:
      q.setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2));
      break;
    case 5:
      q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
      break;
    case 6:
      q.setFromEuler(new THREE.Euler(Math.PI, 0, 0));
      break;
    default:
      q.identity();
      break;
  }

  return q;
}

function buildRestPositions(count: number): Vec3[] {
  if (count <= 1) {
    return [[0, DICE_HALF, 0]];
  }

  const left = -SURFACE_WIDTH / 2 + DICE_HALF + 0.35;
  const right = SURFACE_WIDTH / 2 - DICE_HALF - 0.35;
  const step = (right - left) / (count - 1);

  return Array.from({ length: count }, (_, index) => [left + step * index, DICE_HALF, 0]);
}

function DotFace({ value, position, rotation, held }: { value: number; position: Vec3; rotation: Vec3; held: boolean }) {
  const faceSize = DICE_SIZE * 0.78;
  const spread = faceSize * 0.27;
  const dotRadius = DICE_SIZE * 0.06;
  const dotDepth = DICE_SIZE * 0.017;
  const dotColor = held ? "#143f82" : "#1f365e";

  const dots = FACE_DOTS[value] || FACE_DOTS[1];

  return (
    <group position={position} rotation={rotation}>
      <mesh receiveShadow>
        <planeGeometry args={[faceSize, faceSize]} />
        <meshStandardMaterial
          color={held ? "#dbe8ff" : "#ffffff"}
          roughness={0.45}
          metalness={0.02}
          transparent
          opacity={0.96}
        />
      </mesh>

      {dots.map(([x, y], index) => (
        <mesh key={`${value}-${index}`} position={[x * spread, y * spread, dotDepth]}>
          <cylinderGeometry args={[dotRadius, dotRadius, dotDepth * 2.2, 20]} />
          <meshStandardMaterial color={dotColor} roughness={0.3} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

function DiceMesh({
  dieRef,
  index,
  held,
  disabled,
  onToggleHold,
}: {
  dieRef: (node: THREE.Group | null) => void;
  index: number;
  held: boolean;
  disabled: boolean;
  onToggleHold: (index: number) => void;
}) {
  return (
    <group
      ref={dieRef}
      onPointerOver={() => {
        if (!disabled) {
          document.body.style.cursor = "pointer";
        }
      }}
      onPointerOut={() => {
        document.body.style.cursor = "default";
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!disabled) {
          onToggleHold(index);
        }
      }}
    >
      <RoundedBox args={[DICE_SIZE, DICE_SIZE, DICE_SIZE]} radius={0.14} smoothness={8} castShadow receiveShadow>
        <meshStandardMaterial
          color={held ? "#d4e5ff" : "#f4f8ff"}
          roughness={0.32}
          metalness={0.04}
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
        />
      ))}
    </group>
  );
}

function DiceScene({ dice, held, disabled, rollSequence, onToggleHold }: DiceBoxProps) {
  const count = dice.length;
  const restPositions = useMemo(() => buildRestPositions(count), [count]);

  const dieRefs = useRef<(THREE.Group | null)[]>([]);
  const stateRef = useRef<DieState[]>([]);
  const previousRollSequenceRef = useRef(rollSequence);
  const initializedRef = useRef(false);

  useEffect(() => {
    dieRefs.current = Array.from({ length: count }, (_, index) => dieRefs.current[index] || null);
    stateRef.current = Array.from({ length: count }, (_, index) => {
      const existing = stateRef.current[index];
      if (existing) {
        existing.targetQuaternion = getTargetQuaternion(dice[index]);
        return existing;
      }

      return {
        velocity: new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
        targetQuaternion: getTargetQuaternion(dice[index]),
        rolling: false,
        settling: true,
      };
    });
  }, [count, dice]);

  useEffect(() => {
    for (let index = 0; index < count; index += 1) {
      const die = dieRefs.current[index];
      const state = stateRef.current[index];
      if (!die || !state) {
        continue;
      }

      state.targetQuaternion = getTargetQuaternion(dice[index]);
      if (!state.rolling) {
        state.settling = true;
      }
    }
  }, [count, dice]);

  useEffect(() => {
    if (rollSequence === previousRollSequenceRef.current) {
      return;
    }

    previousRollSequenceRef.current = rollSequence;

    const xMin = -SURFACE_WIDTH / 2 + DICE_HALF + 0.15;
    const xMax = SURFACE_WIDTH / 2 - DICE_HALF - 0.15;
    const zMin = -SURFACE_DEPTH / 2 + DICE_HALF + 0.15;
    const zMax = SURFACE_DEPTH / 2 - DICE_HALF - 0.15;

    // Every non-held die receives initial velocity in this exact effect tick.
    for (let index = 0; index < count; index += 1) {
      const die = dieRefs.current[index];
      const state = stateRef.current[index];
      if (!die || !state) {
        continue;
      }

      state.targetQuaternion = getTargetQuaternion(dice[index]);

      if (held[index]) {
        state.velocity.set(0, 0, 0);
        state.angularVelocity.set(0, 0, 0);
        state.rolling = false;
        state.settling = true;
        continue;
      }

      die.position.set(
        randomBetween(xMin, xMax),
        randomBetween(DICE_HALF + 0.92, AIR_HEIGHT - DICE_HALF - 0.35),
        randomBetween(zMin, zMax)
      );

      state.velocity.set(randomBetween(-4.2, 4.2), randomBetween(4.8, 7.6), randomBetween(-3.8, 3.8));
      state.angularVelocity.set(
        randomBetween(-13.4, 13.4),
        randomBetween(-13.4, 13.4),
        randomBetween(-13.4, 13.4)
      );
      state.rolling = true;
      state.settling = false;
    }
  }, [count, dice, held, rollSequence]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);

    for (let index = 0; index < count; index += 1) {
      const die = dieRefs.current[index];
      const state = stateRef.current[index];
      if (!die || !state) {
        continue;
      }

      if (!initializedRef.current) {
        const [x, y, z] = restPositions[index] || [0, DICE_HALF, 0];
        die.position.set(x, y, z);
        die.quaternion.copy(state.targetQuaternion);
      }

      if (state.rolling) {
        state.velocity.y += -18.5 * dt;
        die.position.addScaledVector(state.velocity, dt);

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

        if (die.position.x < -xLimit) {
          die.position.x = -xLimit;
          state.velocity.x = Math.abs(state.velocity.x) * WALL_RESTITUTION;
        } else if (die.position.x > xLimit) {
          die.position.x = xLimit;
          state.velocity.x = -Math.abs(state.velocity.x) * WALL_RESTITUTION;
        }

        if (die.position.z < -zLimit) {
          die.position.z = -zLimit;
          state.velocity.z = Math.abs(state.velocity.z) * WALL_RESTITUTION;
        } else if (die.position.z > zLimit) {
          die.position.z = zLimit;
          state.velocity.z = -Math.abs(state.velocity.z) * WALL_RESTITUTION;
        }

        if (die.position.y < yFloor) {
          die.position.y = yFloor;
          state.velocity.y = Math.abs(state.velocity.y) * FLOOR_RESTITUTION;
          state.velocity.x *= 0.9;
          state.velocity.z *= 0.9;
        } else if (die.position.y > yCeiling) {
          die.position.y = yCeiling;
          state.velocity.y = -Math.abs(state.velocity.y) * 0.42;
        }

        state.velocity.multiplyScalar(Math.exp(-1.2 * dt));
        state.angularVelocity.multiplyScalar(Math.exp(-2.5 * dt));

        if (
          die.position.y <= yFloor + 0.01 &&
          state.velocity.lengthSq() < 0.12 &&
          state.angularVelocity.lengthSq() < 0.16
        ) {
          state.velocity.set(0, 0, 0);
          state.angularVelocity.set(0, 0, 0);
          state.rolling = false;
          state.settling = true;
        }
      }
    }

    for (let firstIndex = 0; firstIndex < count; firstIndex += 1) {
      const firstDie = dieRefs.current[firstIndex];
      const firstState = stateRef.current[firstIndex];
      if (!firstDie || !firstState) {
        continue;
      }

      for (let secondIndex = firstIndex + 1; secondIndex < count; secondIndex += 1) {
        const secondDie = dieRefs.current[secondIndex];
        const secondState = stateRef.current[secondIndex];
        if (!secondDie || !secondState) {
          continue;
        }

        collisionNormal.subVectors(secondDie.position, firstDie.position);
        const distanceSq = collisionNormal.lengthSq();
        if (distanceSq <= 0 || distanceSq >= DICE_COLLISION_DISTANCE_SQ) {
          continue;
        }

        const distance = Math.sqrt(distanceSq);
        collisionNormal.multiplyScalar(1 / Math.max(distance, 1e-4));
        const overlap = DICE_COLLISION_DISTANCE - distance + 0.002;

        const firstLocked = Boolean(held[firstIndex] && !firstState.rolling);
        const secondLocked = Boolean(held[secondIndex] && !secondState.rolling);

        if (firstLocked && secondLocked) {
          continue;
        }

        if (firstLocked) {
          secondDie.position.addScaledVector(collisionNormal, overlap);
        } else if (secondLocked) {
          firstDie.position.addScaledVector(collisionNormal, -overlap);
        } else {
          firstDie.position.addScaledVector(collisionNormal, -overlap * 0.5);
          secondDie.position.addScaledVector(collisionNormal, overlap * 0.5);
        }

        if (firstLocked) {
          const velocityAlongNormal = secondState.velocity.dot(collisionNormal);
          if (velocityAlongNormal < 0) {
            secondState.velocity.addScaledVector(
              collisionNormal,
              -(1 + COLLISION_RESTITUTION) * velocityAlongNormal
            );
          }
        } else if (secondLocked) {
          const velocityAlongNormal = firstState.velocity.dot(collisionNormal);
          if (velocityAlongNormal > 0) {
            firstState.velocity.addScaledVector(
              collisionNormal,
              -(1 + COLLISION_RESTITUTION) * velocityAlongNormal
            );
          }
        } else {
          relativeVelocityVector.subVectors(secondState.velocity, firstState.velocity);
          const relativeVelocityAlongNormal = relativeVelocityVector.dot(collisionNormal);
          if (relativeVelocityAlongNormal < 0) {
            const impulse = (-(1 + COLLISION_RESTITUTION) * relativeVelocityAlongNormal) / 2;
            firstState.velocity.addScaledVector(collisionNormal, -impulse);
            secondState.velocity.addScaledVector(collisionNormal, impulse);
          }
        }

        collisionSpinAxis.set(collisionNormal.z, 0.35, -collisionNormal.x).normalize();
        if (!firstLocked) {
          firstState.angularVelocity.addScaledVector(collisionSpinAxis, -2.6);
          firstState.rolling = true;
          firstState.settling = false;
        }
        if (!secondLocked) {
          secondState.angularVelocity.addScaledVector(collisionSpinAxis, 2.6);
          secondState.rolling = true;
          secondState.settling = false;
        }
      }
    }

    for (let index = 0; index < count; index += 1) {
      const die = dieRefs.current[index];
      const state = stateRef.current[index];
      if (!die || !state || state.rolling) {
        continue;
      }

      if (state.settling) {
        const settleAmount = 1 - Math.exp(-10 * dt);
        die.quaternion.slerp(state.targetQuaternion, settleAmount);
        die.position.y = THREE.MathUtils.lerp(die.position.y, DICE_HALF, settleAmount);

        if (die.quaternion.angleTo(state.targetQuaternion) < 0.014) {
          die.quaternion.copy(state.targetQuaternion);
          state.settling = false;
        }
      }
    }

    initializedRef.current = true;
  });

  return (
    <>
      <ambientLight intensity={0.92} />
      <directionalLight
        position={[4.8, 8.4, 2.8]}
        intensity={1.05}
        castShadow
        shadow-mapSize-width={1536}
        shadow-mapSize-height={1536}
        shadow-bias={-0.00025}
        shadow-radius={7}
      />
      <pointLight position={[-3.8, 2.9, -1.8]} intensity={0.42} color="#b6c8e8" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[SURFACE_WIDTH + 2.4, SURFACE_DEPTH + 2.2]} />
        <shadowMaterial transparent opacity={0.2} />
      </mesh>

      {restPositions.map((_, index) => (
        <DiceMesh
          key={index}
          dieRef={(node) => {
            dieRefs.current[index] = node;
          }}
          index={index}
          held={Boolean(held[index])}
          disabled={disabled}
          onToggleHold={onToggleHold}
        />
      ))}
    </>
  );
}

export function DiceBox({ dice, held, disabled, rollSequence, onToggleHold }: DiceBoxProps) {
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
          {dice.map((value, index) => (
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
              <span className="font-mono text-xl font-bold leading-none text-[#123f84]">
                {clampDiceValue(value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
