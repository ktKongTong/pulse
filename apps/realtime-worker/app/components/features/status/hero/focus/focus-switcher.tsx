import { AnimatePresence, motion } from "motion/react";

import { AppIcon } from "./app-icon";
import { cn } from "@/lib/utils";

interface FocusSwitcherProps {
  appId: string;
  appLabel: string;
}
export function FocusSwitcher({appId, appLabel, className, ...rest}: FocusSwitcherProps & React.HTMLProps<HTMLDivElement>) {
  return (
    <div className={cn(
      "relative w-lg h-12",
      className
    )}
      {...rest}
    >
      <AnimatePresence initial={false} mode="sync">
        <motion.div
          key={appId}
          initial={{ y: 8, x:0, opacity: 0, scale: 0.5 }}
          animate={{ y: 0, x:0, opacity: 1, scale: 1 }}
          exit={{ y: -8, x:0, opacity: 0, scale: 0.5 }}
          transition={{
            y: { duration: 0.48, ease: 'easeInOut' },
            opacity: { duration: 0.38, ease: "easeInOut" },
            scale: { duration: 0.38, ease: "easeInOut" },
          }}
          className="absolute items-start text-start inset-y-0 left-0"
        >
          <div className="flex items-center justify-center gap-4">
            <AppIcon appId={appId} label={appLabel} />
            <div className="flex flex-col gap-0">
              {/*<p className="text-xs font-medium text-nowrap font-sans uppercase tracking-[0.2rem] text-[#7b4110]">
                {appLabel}

              </p>*/}
              <p className="text-xs font-medium text-nowrap font-sans text-[#7b4110]">
                正在 {appLabel} 中闲逛

              </p>
              {/*<span className="text-[10px] font-medium text-nowrap font-sans text-[#7b4110]">正在网上冲浪🏄</span>*/}
            </div>

          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
