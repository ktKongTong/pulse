export function glyphForApp(appId: string, label: string) {
  if (appId.includes("spotify")) return "♪";
  if (appId.includes("Music")) return "♫";
  if (appId.includes("chrome")) return "◎";
  if (appId.includes("edgemac")) return "◌";
  if (appId.includes("openai.codex")) return "✦";
  return (label[0] ?? "•").toUpperCase();
}

export function providerBadgeFallback(providerId: string) {
  if (providerId === "spotify") {
    return (
      <div className="flex size-8 items-center justify-center rounded-full bg-[#1db954] text-black">
        <span className="text-sm font-black">≋</span>
      </div>
    );
  }

  if (providerId === "apple-music") {
    return (
      <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-pink-400 text-white">
        <span className="text-sm font-bold">♫</span>
      </div>
    );
  }

  return (
    <div className="flex size-8 items-center justify-center rounded-full bg-stone-900 text-white">
      <span className="text-[10px] font-bold uppercase">{providerId[0]}</span>
    </div>
  );
}

export function iconForApp(appId: string, label: string) {
  const baseClass = "h-9 w-9";

  if (appId.includes("openai.codex")) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-[#6d7cff] text-white shadow-inner">
        <span className="text-xl font-semibold">✦</span>
      </div>
    );
  }

  if (appId.includes("com.microsoft.edgemac")) {
    return (
      <svg viewBox="0 0 24 24" className={baseClass} aria-hidden="true">
        <path fill="#0ea5e9" d="M19.7 16.4c-.9 3.2-3.9 5.6-7.4 5.6-4.3 0-7.8-3.4-7.8-7.6 0-4.1 3.3-7.4 7.4-7.6 2.3-.1 4.5.8 6 2.4-1.1-.4-2.5-.3-3.6.2-2.4 1-3.8 3.6-3.3 6.2h8.7c0 .3 0 .5 0 .8Z"/>
        <path fill="#10b981" d="M20.1 14.7c0-4.6-3.8-8.3-8.4-8.3-3.5 0-6.6 2.2-7.7 5.3.8-1.4 2.4-2.3 4.1-2.3 2.7 0 5 2.2 5 4.9 0 .5-.1.9-.2 1.4h7.1c.1-.3.1-.7.1-1Z"/>
      </svg>
    );
  }

  if (appId.includes("com.google.Chrome")) {
    return (
      <svg viewBox="0 0 24 24" className={baseClass} aria-hidden="true">
        <path fill="#ef4444" d="M12 12L4.6 4.6A10 10 0 0 1 22 8h-10Z"/>
        <path fill="#f59e0b" d="M12 12h10A10 10 0 0 1 7.8 21.1L12 12Z"/>
        <path fill="#10b981" d="M12 12l-4.2 9.1A10 10 0 0 1 4.6 4.6L12 12Z"/>
        <circle cx="12" cy="12" r="4.1" fill="#2563eb"/>
        <circle cx="12" cy="12" r="2.1" fill="#bfdbfe"/>
      </svg>
    );
  }

  if (appId.includes("com.apple.Music")) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-gradient-to-br from-rose-500 to-pink-400 text-white">
        <span className="text-xl font-semibold">♫</span>
      </div>
    );
  }

  if (appId.includes("com.spotify.client")) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1db954] text-black">
        <span className="text-lg font-black">≋</span>
      </div>
    );
  }

  if (appId.includes("com.jetbrains.WebStorm")) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-gradient-to-br from-cyan-400 to-lime-300 text-black">
        <span className="text-[11px] font-black tracking-tight">WS</span>
      </div>
    );
  }

  if (appId.includes("com.tencent.xinWeChat")) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-[#1aad19] text-white">
        <span className="text-lg font-bold">微</span>
      </div>
    );
  }

  if (appId.includes("com.github.GitHubClient")) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-[#24292f] text-white">
        <span className="text-lg">⌘</span>
      </div>
    );
  }

  return <span className="text-[20px] font-semibold text-stone-900">{glyphForApp(appId, label)}</span>;
}
