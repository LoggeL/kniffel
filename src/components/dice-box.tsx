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
const BOX_WIDTH = 7.8;
const BOX_DEPTH = 4.6;
const BOX_HEIGHT = 3.6;

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

  const left = -BOX_WIDTH / 2 + DICE_HALF + 0.35;
  const right = BOX_WIDTH / 2 - DICE_HALF - 0.35;
  const step = (right - left) / (count - 1);

  return Array.from({ length: count }, (_, index) => [left + step * index, DICE_HALF, 0]);
}

function DotFace({ value, position, rotation, held }: { value: number; position: Vec3; rotation: Vec3; held: boolean }) {
  const faceSize = DICE_SIZE * 0.78;
  const spread = faceSize * 0.27;
  const dotRadius = DICE_SIZE * 0.06;
  const dotDepth = DICE_SIZE * 0.017;
  const dotColor = held ? "#1f5f30" : "#1f2937";

  const dots = FACE_DOTS[value] || FACE_DOTS[1];

  return (
    <group position={position} rotation={rotation}>
      <mesh receiveShadow>
        <planeGeometry args={[faceSize, faceSize]} />
        <meshStandardMaterial
          color={held ? "#d9ffe3" : "#ffffff"}
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
          color={held ? "#c0ffd2" : "#f2f6ff"}
          roughness={0.32}
          metalness={0.04}
          emissive={held ? "#2f9e44" : "#000000"}
          emissiveIntensity={held ? 0.48 : 0}
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

    const xMin = -BOX_WIDTH / 2 + DICE_HALF + 0.2;
    const xMax = BOX_WIDTH / 2 - DICE_HALF - 0.2;
    const zMin = -BOX_DEPTH / 2 + DICE_HALF + 0.2;
    const zMax = BOX_DEPTH / 2 - DICE_HALF - 0.2;

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
        randomBetween(DICE_HALF + 0.9, BOX_HEIGHT - DICE_HALF - 0.35),
        randomBetween(zMin, zMax)
      );

      state.velocity.set(randomBetween(-3.6, 3.6), randomBetween(4.4, 7.4), randomBetween(-3.4, 3.4));
      state.angularVelocity.set(
        randomBetween(-12, 12),
        randomBetween(-12, 12),
        randomBetween(-12, 12)
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

        const xLimit = BOX_WIDTH / 2 - DICE_HALF;
        const zLimit = BOX_DEPTH / 2 - DICE_HALF;
        const yFloor = DICE_HALF;
        const yCeiling = BOX_HEIGHT - DICE_HALF;

        if (die.position.x < -xLimit) {
          die.position.x = -xLimit;
          state.velocity.x = Math.abs(state.velocity.x) * 0.66;
        } else if (die.position.x > xLimit) {
          die.position.x = xLimit;
          state.velocity.x = -Math.abs(state.velocity.x) * 0.66;
        }

        if (die.position.z < -zLimit) {
          die.position.z = -zLimit;
          state.velocity.z = Math.abs(state.velocity.z) * 0.66;
        } else if (die.position.z > zLimit) {
          die.position.z = zLimit;
          state.velocity.z = -Math.abs(state.velocity.z) * 0.66;
        }

        if (die.position.y < yFloor) {
          die.position.y = yFloor;
          state.velocity.y = Math.abs(state.velocity.y) * 0.48;
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
      <color attach="background" args={["#070f1c"]} />

      <ambientLight intensity={0.75} />
      <directionalLight
        position={[5.5, 8.5, 3]}
        intensity={1.25}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <pointLight position={[-4.2, 3.2, -1.8]} intensity={0.55} color="#7dd3fc" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[BOX_WIDTH + 0.45, BOX_DEPTH + 0.45]} />
        <meshStandardMaterial color="#111827" roughness={0.92} metalness={0.05} />
      </mesh>

      <mesh position={[0, BOX_HEIGHT / 2, BOX_DEPTH / 2]}>
        <planeGeometry args={[BOX_WIDTH, BOX_HEIGHT]} />
        <meshStandardMaterial color="#67e8f9" transparent opacity={0.16} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, BOX_HEIGHT / 2, -BOX_DEPTH / 2]}>
        <planeGeometry args={[BOX_WIDTH, BOX_HEIGHT]} />
        <meshStandardMaterial color="#67e8f9" transparent opacity={0.14} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[BOX_WIDTH / 2, BOX_HEIGHT / 2, 0]}>
        <planeGeometry args={[BOX_DEPTH, BOX_HEIGHT]} />
        <meshStandardMaterial color="#38bdf8" transparent opacity={0.14} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-BOX_WIDTH / 2, BOX_HEIGHT / 2, 0]}>
        <planeGeometry args={[BOX_DEPTH, BOX_HEIGHT]} />
        <meshStandardMaterial color="#38bdf8" transparent opacity={0.14} side={THREE.DoubleSide} />
      </mesh>

      <mesh position={[0, BOX_HEIGHT / 2, 0]}>
        <boxGeometry args={[BOX_WIDTH, BOX_HEIGHT, BOX_DEPTH]} />
        <meshBasicMaterial color="#67e8f9" wireframe transparent opacity={0.2} />
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
    <div className="mt-3 h-64 w-full overflow-hidden rounded-2xl border border-cyan-500/25 bg-slate-950/70 shadow-[0_24px_65px_-35px_rgba(8,145,178,0.85)] sm:h-72 lg:h-80">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 6.2, 7], fov: 38, near: 0.1, far: 50 }}
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
  );
}
