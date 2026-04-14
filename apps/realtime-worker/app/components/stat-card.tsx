import type { ReactNode } from "react";

export function StatCard(props: {
  title: string;
  value: string;
  secondary?: string;
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/70 p-6 shadow-[0_20px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/80 to-transparent" />
      <div className="space-y-3">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-slate-500">{props.title}</p>
        <h3 className="font-display text-4xl font-bold tracking-tight text-slate-950">{props.value}</h3>
        {props.secondary ? <p className="max-w-[22rem] text-sm leading-6 text-slate-600">{props.secondary}</p> : null}
      </div>
      {props.children ? <div className="mt-5">{props.children}</div> : null}
    </section>
  );
}
