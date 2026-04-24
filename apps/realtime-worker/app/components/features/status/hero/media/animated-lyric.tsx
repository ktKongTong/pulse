import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";

import type { LyricCue, LyricLine } from "./lrc";
import { cn } from "@/lib/utils";

type LyricRole = "previous" | "current" | "next";

interface AnimatedLyricStackProps {
  cue: LyricCue;
}

interface LyricStackItem {
  key: string;
  text: string;
  role: LyricRole;
}

const EASE_OUT_QUINT = [0.22, 1, 0.36, 1] as const;

function lineKey(line: LyricLine) {
  return `${line.timeSeconds}:${line.text}`;
}

function buildStackItems(cue: LyricCue): LyricStackItem[] {
  const items: LyricStackItem[] = [];

  if (cue.previous) {
    items.push({
      key: lineKey(cue.previous),
      text: cue.previous.text,
      role: "previous",
    });
  }

  items.push({
    key: cue.current ? lineKey(cue.current) : "lyrics-placeholder",
    text: cue.current?.text ?? "Lyrics start soon.",
    role: "current",
  });

  // if (cue.next) {
  //   items.push({
  //     key: lineKey(cue.next),
  //     text: cue.next.text,
  //     role: "next",
  //   });
  // }

  if (items.length === 0) {
    items.push({
      key: 'no-lyric',
      text: '暂无歌词',
      role: "current",
    });
  }


  return items;
}

function resolveAnimateState(role: LyricRole, shouldReduceMotion: boolean) {
  if (shouldReduceMotion) {
    return {
      opacity: role === "current" ? 1 : 0.45,
    };
  }

  switch (role) {
    case "previous":
      return {
        y: 0,
        scale: 0.7,
        opacity: 0.4,
      };
    case "current":
      return {
        y: 16,
        scale: 1,
        opacity: 1,
      };
    case "next":
      return {
        y: 40,
        scale: 0.84,
        opacity: 0.42,
      };
  }
}

function resolveInitialState(role: LyricRole, shouldReduceMotion: boolean) {
  if (shouldReduceMotion) {
    return {
      opacity: 0,
    };
  }

  switch (role) {
    case "previous":
      return {
        y: 10,
        scale: 0.2,
        opacity: 0,
      };
    case "current":
      return {
        y: 34,
        scale: 0.82,
        opacity: 0,
      };
    case "next":
      return {
        y: 72,
        scale: 0.12,
        opacity: 0,
      };
  }
}

function resolveExitState(role: LyricRole, shouldReduceMotion: boolean) {
  if (shouldReduceMotion) {
    return {
      opacity: 0,
    };
  }

  switch (role) {
    case "previous":
      return {
        y: 3,
        scale: 0,
        opacity: 0,
      };
    case "current":
      return {
        y: 6,
        scale: 0.55,
        opacity: 0,
      };
    case "next":
      return {
        y: 16,
        scale: 0.55,
        opacity: 0,
      };
  }
}

function resolveTextClassName(role: LyricRole) {
  switch (role) {
    case "previous":
    case "next":
      return "text-[13px]";
    case "current":
      return "text-md font-medium leading-7 text-stone-950 md:text-[15px]";
  }
}

export function AnimatedLyricStack(props: AnimatedLyricStackProps) {
  const shouldReduceMotion = useReducedMotion() ?? false;
  const items = useMemo(() => buildStackItems(props.cue), [props.cue]);

  return (
    <div className="relative h-12 w-full overflow-visible">
      <AnimatePresence initial={false} mode="sync">
        {items.map((item) => (
          <motion.p
            key={item.key}
            className={
              cn(
                "absolute inset-x-0 m-0 line-clamp-1 w-[240px] origin-left text-left tracking-tight will-change-transform",
                item.role === 'current' ?
                  'text-md font-medium leading-7 text-stone-950 md:text-[15px]' :
                  'text-stone-700 text-[13px]'
              )
            }
            initial={resolveInitialState(item.role, shouldReduceMotion)}
            animate={resolveAnimateState(item.role, shouldReduceMotion)}
            exit={resolveExitState(item.role, shouldReduceMotion)}
            transition={{
              y: { duration: 0.3, ease: 'easeInOut' },
              scale: { duration: 0.4, ease: 'easeInOut' },
              opacity: { duration: 0.4, ease: "easeInOut" },
            }}
            style={{ transformOrigin: "left center" }}
          >
            {item.text}
          </motion.p>
        ))}
      </AnimatePresence>
    </div>
  );
}
