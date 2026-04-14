import { AnimatePresence, motion } from "motion/react";

import { AppIcon } from "./app-icon";

export function FocusSwitcher(props: { appId: string; appLabel: string }) {
  return (
    <div className="relative mx-auto min-h-[72px] max-w-lg">
      <AnimatePresence initial={false} mode="sync">
        <motion.div
          key={props.appId}
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -8, opacity: 0 }}
          transition={{
            y: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.18, ease: "easeOut" },
          }}
          className="absolute inset-0"
        >
          <div className="flex items-center justify-center gap-4">
            <AppIcon appId={props.appId} label={props.appLabel} />
            <h1 className="font-sans text-[16px] font-medium tracking-tight text-stone-950 md:text-[18px]">
              {props.appLabel}
            </h1>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
