"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DiceBox3DProps {
  dice: number[];
  held: boolean[];
  disabled: boolean;
  rollSequence: number;
  onToggleHold: (index: number) => void;
  activeColor?: string;
  playerIcon?: string | null;
}

type RollPhase = "idle" | "rolling" | "settling";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ROLL_DURATION = 0.8; // seconds of wild spinning
const SETTLE_DURATION = 0.3; // seconds to slerp to target

/** Standard Western die – target Euler rotation so value N faces +Y (up). */
const TARGET_ROTATIONS: Record<number, THREE.Euler> = {
  1: new THREE.Euler(0, 0, 0),
  2: new THREE.Euler(-Math.PI / 2, 0, 0),
  3: new THREE.Euler(0, 0, Math.PI / 2),
  4: new THREE.Euler(0, 0, -Math.PI / 2),
  5: new THREE.Euler(Math.PI / 2, 0, 0),
  6: new THREE.Euler(Math.PI, 0, 0),
};

/** 2D dot positions per face value (range roughly -0.3 … 0.3). */
const DOT_POSITIONS_2D: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [0.25, -0.25],
    [-0.25, 0.25],
  ],
  3: [
    [0.25, -0.25],
    [0, 0],
    [-0.25, 0.25],
  ],
  4: [
    [-0.25, -0.25],
    [0.25, -0.25],
    [-0.25, 0.25],
    [0.25, 0.25],
  ],
  5: [
    [-0.25, -0.25],
    [0.25, -0.25],
    [0, 0],
    [-0.25, 0.25],
    [0.25, 0.25],
  ],
  6: [
    [-0.25, -0.25],
    [-0.25, 0],
    [-0.25, 0.25],
    [0.25, -0.25],
    [0.25, 0],
    [0.25, 0.25],
  ],
};

/** Face assignment: which value lives on which axis direction. */
// +Y=1, -Y=6, +Z=2, -Z=5, +X=3, -X=4
const FACE_VALUE_MAP: { value: number; normal: "px" | "nx" | "py" | "ny" | "pz" | "nz" }[] = [
  { value: 1, normal: "py" },
  { value: 6, normal: "ny" },
  { value: 2, normal: "pz" },
  { value: 5, normal: "nz" },
  { value: 3, normal: "px" },
  { value: 4, normal: "nx" },
];

const DOT_RADIUS = 0.06;
const FACE_OFFSET = 0.52; // slightly above the rounded-box surface

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function clampDiceValue(value: number): number {
  if (value < 1 || value > 6) return 1;
  return value;
}

/** Convert 2D face-local coords to 3D positions depending on face normal. */
function dotsFor3DFace(
  faceNormal: "px" | "nx" | "py" | "ny" | "pz" | "nz",
  value: number,
): [number, number, number][] {
  const dots2D = DOT_POSITIONS_2D[value];
  if (!dots2D) return [];

  return dots2D.map(([a, b]) => {
    switch (faceNormal) {
      case "py":
        return [a, FACE_OFFSET, b];
      case "ny":
        return [a, -FACE_OFFSET, -b];
      case "pz":
        return [a, b, FACE_OFFSET];
      case "nz":
        return [-a, b, -FACE_OFFSET];
      case "px":
        return [FACE_OFFSET, b, -a];
      case "nx":
        return [-FACE_OFFSET, b, a];
    }
  });
}

/** Shared sphere geometry for all dots (created once). */
const dotGeometry = new THREE.SphereGeometry(DOT_RADIUS, 12, 8);

/* ------------------------------------------------------------------ */
/*  Die3D – individual 3D die                                          */
/* ------------------------------------------------------------------ */

interface Die3DProps {
  value: number;
  held: boolean;
  disabled: boolean;
  rollSequence: number;
  index: number;
  positionX: number;
  onToggleHold: (index: number) => void;
  playerIcon?: string | null;
}

function Die3D({
  value,
  held,
  disabled,
  rollSequence,
  index,
  positionX,
  onToggleHold,
  playerIcon,
}: Die3DProps) {
  const groupRef = useRef<THREE.Group>(null);

  const prevRollSeq = useRef(rollSequence);
  const phaseRef = useRef<RollPhase>("idle");
  const phaseTimerRef = useRef(0);

  // Random spin axis/speed generated per roll
  const spinAxisRef = useRef(new THREE.Vector3(1, 1, 0).normalize());
  const spinSpeedRef = useRef(12);

  // Quaternions for slerp
  const settleStartQuat = useRef(new THREE.Quaternion());
  const targetQuat = useRef(new THREE.Quaternion());

  // Compute target quaternion from value
  const safeValue = clampDiceValue(value);
  const targetEuler = TARGET_ROTATIONS[safeValue];

  useEffect(() => {
    targetQuat.current.setFromEuler(targetEuler);
  }, [targetEuler]);

  // Detect rollSequence changes -> start rolling
  useEffect(() => {
    if (rollSequence !== prevRollSeq.current) {
      prevRollSeq.current = rollSequence;
      if (!held) {
        phaseRef.current = "rolling";
        phaseTimerRef.current = 0;
        // Pick random spin parameters
        spinAxisRef.current
          .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
          .normalize();
        spinSpeedRef.current = 10 + Math.random() * 8;
      }
    }
  }, [rollSequence, held]);

  // Set initial rotation immediately (no animation) on mount
  useEffect(() => {
    if (groupRef.current && phaseRef.current === "idle") {
      groupRef.current.quaternion.setFromEuler(targetEuler);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const dt = Math.min(delta, 0.05); // cap delta for tab-away

    if (phaseRef.current === "rolling") {
      phaseTimerRef.current += dt;
      // Spin wildly
      const q = groupRef.current.quaternion;
      const rotDelta = new THREE.Quaternion().setFromAxisAngle(
        spinAxisRef.current,
        spinSpeedRef.current * dt,
      );
      q.multiplyQuaternions(rotDelta, q);

      if (phaseTimerRef.current >= ROLL_DURATION) {
        // Transition to settling
        phaseRef.current = "settling";
        phaseTimerRef.current = 0;
        settleStartQuat.current.copy(groupRef.current.quaternion);
        targetQuat.current.setFromEuler(TARGET_ROTATIONS[safeValue]);
      }
    } else if (phaseRef.current === "settling") {
      phaseTimerRef.current += dt;
      const t = Math.min(phaseTimerRef.current / SETTLE_DURATION, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      groupRef.current.quaternion.slerpQuaternions(
        settleStartQuat.current,
        targetQuat.current,
        eased,
      );
      if (t >= 1) {
        phaseRef.current = "idle";
      }
    } else {
      // idle – snap to target (handles external value changes)
      groupRef.current.quaternion.setFromEuler(TARGET_ROTATIONS[safeValue]);
    }
  });

  const handleClick = useCallback(() => {
    if (!disabled) onToggleHold(index);
  }, [disabled, index, onToggleHold]);

  // Materials
  const bodyColor = held ? "#c4d6f5" : "#f5f0e5";
  const dotColor = held ? "#1a3a6e" : "#333333";

  // Pre-compute all face dots
  const allDots = useMemo(() => {
    const result: { pos: [number, number, number]; key: string }[] = [];
    for (const face of FACE_VALUE_MAP) {
      const positions = dotsFor3DFace(face.normal, face.value);
      positions.forEach((pos, di) => {
        result.push({ pos, key: `${face.normal}-${di}` });
      });
    }
    return result;
  }, []);

  const showEmoji = value === 0 && playerIcon;

  return (
    <group ref={groupRef} position={[positionX, 0, 0]} onClick={handleClick}>
      {/* Die body */}
      <RoundedBox args={[1, 1, 1]} radius={0.12} smoothness={4}>
        <meshStandardMaterial color={bodyColor} roughness={0.35} metalness={0.05} />
      </RoundedBox>

      {/* Held glow */}
      {held && (
        <RoundedBox args={[1.06, 1.06, 1.06]} radius={0.13} smoothness={4}>
          <meshStandardMaterial
            color="#4488cc"
            transparent
            opacity={0.18}
            roughness={1}
            metalness={0}
          />
        </RoundedBox>
      )}

      {/* Dots on all 6 faces */}
      {allDots.map(({ pos, key }) => (
        <mesh key={key} geometry={dotGeometry} position={pos}>
          <meshStandardMaterial color={dotColor} roughness={0.6} metalness={0.1} />
        </mesh>
      ))}

      {/* Emoji overlay when not yet rolled */}
      {showEmoji && (
        <Html
          center
          position={[0, 0.55, 0]}
          style={{ pointerEvents: "none", userSelect: "none" }}
          distanceFactor={1.8}
        >
          <div style={{ fontSize: "48px", opacity: 0.7, lineHeight: 1 }}>{playerIcon}</div>
        </Html>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  DiceBox3D – main exported component                                */
/* ------------------------------------------------------------------ */

export function DiceBox3D({
  dice,
  held,
  disabled,
  rollSequence,
  onToggleHold,
  activeColor,
  playerIcon,
}: DiceBox3DProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const dicePositions = useMemo(() => [-3, -1.5, 0, 1.5, 3], []);

  return (
    <motion.div
      className="mt-4 rounded-[24px] border-2 bg-[#f8eed8]/85 px-2 pb-3 pt-2 sm:px-4"
      style={{ borderColor: activeColor || "rgba(42,79,137,0.55)" }}
      animate={
        activeColor
          ? {
              boxShadow: [
                `inset 0 1px 0 rgba(255,255,255,0.7), 0 18px 40px -30px rgba(24,58,116,0.85), 0 0 0px 0px ${activeColor}30`,
                `inset 0 1px 0 rgba(255,255,255,0.7), 0 18px 40px -30px rgba(24,58,116,0.85), 0 0 20px 8px ${activeColor}55`,
                `inset 0 1px 0 rgba(255,255,255,0.7), 0 18px 40px -30px rgba(24,58,116,0.85), 0 0 0px 0px ${activeColor}30`,
              ],
            }
          : {
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.7), 0 18px 40px -30px rgba(24,58,116,0.85)",
            }
      }
      transition={
        activeColor ? { duration: 2.5, repeat: Infinity, ease: "easeInOut" } : {}
      }
    >
      {/* 3D Canvas */}
      <div
        className="w-full overflow-hidden rounded-[16px]"
        style={{ aspectRatio: "3 / 1" }}
      >
        {mounted && (
          <Canvas
            camera={{ position: [0, 4, 5], fov: 50 }}
            gl={{ alpha: true, antialias: true }}
            style={{ background: "transparent" }}
            onCreated={({ camera }) => {
              camera.lookAt(0, 0, 0);
            }}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[4, 6, 3]} intensity={0.9} castShadow={false} />

            {dice.map((value, index) => (
              <Die3D
                key={index}
                value={value}
                held={Boolean(held[index])}
                disabled={disabled}
                rollSequence={rollSequence}
                index={index}
                positionX={dicePositions[index]}
                onToggleHold={onToggleHold}
                playerIcon={playerIcon}
              />
            ))}
          </Canvas>
        )}
      </div>

      {/* Halt controls (HTML below canvas) */}
      <div className="mt-1 flex justify-center">
        <div
          className="grid w-full max-w-3xl gap-2 sm:gap-3"
          style={{ gridTemplateColumns: `repeat(5, minmax(0, 1fr))` }}
        >
          {dice.map((value, index) => (
            <div
              key={`die-control-${index}`}
              onClick={() => {
                if (!disabled) onToggleHold(index);
              }}
              className={[
                "flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-md border border-[#2a4f89]/35 bg-[#f2e6cc]/70 px-1 py-2 text-[#17407b] transition",
                !disabled && "cursor-pointer hover:bg-[#e8d9b8] active:scale-95",
                held[index] && "ring-2 ring-[#1f4d90]",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="select-none text-[11px] font-medium uppercase tracking-[0.11em]">
                {held[index] ? "\u2713 Halt" : "Halt"}
              </span>
              <span className="text-xs text-[#2a4f89]/70">Augen</span>
              <span className="font-mono text-xl font-bold leading-none text-[#123f84]">
                {value < 1 || value > 6 ? 1 : value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
