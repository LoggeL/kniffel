"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

interface DiceBoxProps {
  dice: number[];
  held: boolean[];
  disabled: boolean;
  rollSequence: number;
  onToggleHold: (index: number) => void;
  activeColor?: string;
  playerIcon?: string | null;
}

function clampDiceValue(value: number): number {
  if (value < 1 || value > 6) return 1;
  return value;
}

// Classic dot positions for each face value.
// Grid is 3x3: positions are [col, row] where 0=top/left, 1=center, 2=bottom/right.
const DOT_POSITIONS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [2, 0],
    [0, 2],
  ],
  3: [
    [2, 0],
    [1, 1],
    [0, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [0, 1],
    [0, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ],
};

function DiceFace({ value, held, rolling, disabled, onClick, dieIndex, playerIcon }: {
  value: number;
  held: boolean;
  rolling: boolean;
  disabled: boolean;
  onClick: () => void;
  dieIndex: number;
  playerIcon?: string | null;
}) {
  const showIcon = value === 0 && playerIcon;
  const dots = showIcon ? [] : (DOT_POSITIONS[clampDiceValue(value)] ?? DOT_POSITIONS[1]);

  // Map grid positions to percentage offsets
  const pct = (pos: number) => pos === 0 ? "20%" : pos === 1 ? "50%" : "80%";

  return (
    <div
      onClick={() => { if (!disabled) onClick(); }}
      className={[
        "relative aspect-square w-full max-w-[72px] sm:max-w-[80px] select-none",
        "transition-transform duration-100",
        !disabled && "cursor-pointer hover:scale-105 active:scale-95",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ perspective: "200px" }}
    >
      <div
        className={[
          "relative h-full w-full rounded-[16%]",
          held
            ? "ring-[3px] ring-[#1f4d90] ring-offset-1 ring-offset-[#f8eed8] shadow-[0_2px_8px_rgba(31,77,144,0.45),inset_0_2px_4px_rgba(255,255,255,0.6)]"
            : "shadow-[0_3px_6px_rgba(0,0,0,0.18),inset_0_2px_4px_rgba(255,255,255,0.7)]",
          rolling && "animate-dice-roll",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          background: held
            ? "linear-gradient(145deg, #dbe8ff 0%, #c4d6f5 100%)"
            : "linear-gradient(145deg, #ffffff 0%, #e8e4dc 100%)",
          animationDelay: rolling ? `${dieIndex * 60}ms` : undefined,
          animationDuration: rolling ? `${900 + dieIndex * 50}ms` : undefined,
        }}
      >
        {dots.map(([col, row], i) => (
          <div
            key={i}
            className="absolute h-[20%] w-[20%] rounded-full"
            style={{
              left: pct(col),
              top: pct(row),
              transform: "translate(-50%, -50%)",
              background: held
                ? "radial-gradient(circle at 38% 38%, #2a5a9e, #143f82)"
                : "radial-gradient(circle at 38% 38%, #555, #2a2a2a)",
              boxShadow: "inset 0 1.5px 3px rgba(0,0,0,0.45), 0 0.5px 0 rgba(255,255,255,0.15)",
            }}
          />
        ))}
        {showIcon && (
          <div className="absolute inset-0 flex items-center justify-center text-2xl sm:text-3xl opacity-60">
            {playerIcon}
          </div>
        )}
      </div>
    </div>
  );

}

export function DiceBox({ dice, held, disabled, rollSequence, onToggleHold, activeColor, playerIcon }: DiceBoxProps) {
  const prevRollSequence = useRef(rollSequence);
  const [rollingDice, setRollingDice] = useState<boolean[]>(() => Array(dice.length).fill(false));

  useEffect(() => {
    if (rollSequence === prevRollSequence.current) return;
    prevRollSequence.current = rollSequence;

    // Snapshot held at time of roll
    const heldSnapshot = [...held];
    const rolling = dice.map((_, i) => !heldSnapshot[i]);
    setRollingDice(rolling);

    const timer = setTimeout(() => {
      setRollingDice(Array(dice.length).fill(false));
    }, 1200);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollSequence]);

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
        activeColor
          ? { duration: 2.5, repeat: Infinity, ease: "easeInOut" }
          : {}
      }
    >
      {/* Dice row */}
      <div className="flex items-center justify-center gap-3 py-6 sm:gap-4 sm:py-8">
        {dice.map((value, index) => (
          <DiceFace
            key={index}
            value={value}
            held={Boolean(held[index])}
            rolling={Boolean(rollingDice[index])}
                dieIndex={index}
            disabled={disabled}
            onClick={() => onToggleHold(index)}
            playerIcon={playerIcon}
          />
        ))}
      </div>

      {/* Controls row */}
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
              className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-md border border-[#2a4f89]/35 bg-[#f2e6cc]/70 px-1 py-2 text-[#17407b]"
            >
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] uppercase tracking-[0.11em]">
                <input
                  type="checkbox"
                  checked={Boolean(held[index])}
                  onChange={() => onToggleHold(index)}
                  disabled={disabled}
                  className="h-5 w-5 cursor-pointer"
                  style={{ accentColor: activeColor || "#1f4d90" }}
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
    </motion.div>
  );
}
