export const APP_BRAND_ASSETS: Record<string, string> = {
  "com.microsoft.edgemac": "/brand-assets/microsoft-edge.png",
  "com.google.Chrome": "/brand-assets/google-chrome.png",
  "com.spotify.client": "/brand-assets/spotify.png",
  "com.apple.Music": "/brand-assets/apple-music.png",
  "com.jetbrains.WebStorm": "/brand-assets/webstorm.svg",
  "com.openai.codex": "/brand-assets/codex.svg",
  "com.tencent.xinWeChat": "/brand-assets/wechat.png",
  "com.github.GitHubClient": "/brand-assets/github.png",
};

export const PROVIDER_BRAND_ASSETS: Record<string, string> = {
  spotify: "/brand-assets/spotify.png",
  "apple-music": "/brand-assets/apple-music.png",
};

export function getAppBrandAsset(appId: string) {
  return APP_BRAND_ASSETS[appId] ?? null;
}

export function getProviderBrandAsset(providerId?: string) {
  if (!providerId) return null;
  return PROVIDER_BRAND_ASSETS[providerId] ?? null;
}
