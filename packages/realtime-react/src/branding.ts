export interface DefaultBranding {
  assetUrl: string | null;
}

export function resolveDefaultAppBranding(
  appId: string,
  _label: string,
): DefaultBranding {
  return {
    assetUrl: knownAppBrandUrl(appId),
  };
}

export function resolveDefaultProviderBranding(
  providerId?: string,
): DefaultBranding | null {
  if (!providerId) return null;

  return {
    assetUrl: knownProviderBrandUrl(providerId),
  };
}

function knownAppBrandUrl(appId: string) {
  switch (appId) {
    case "com.spotify.client":
      return assetUrl("spotify.png");
    case "com.apple.Music":
      return assetUrl("apple-music.png");
    case "com.microsoft.edgemac":
      return assetUrl("microsoft-edge.png");
    case "com.openai.codex":
      return assetUrl("codex.svg");
    case "com.jetbrains.WebStorm":
      return assetUrl("webstorm.svg");
    case "com.tencent.xinWeChat":
      return assetUrl("wechat.png");
    case "com.github.GitHubClient":
      return assetUrl("github.png");
    default:
      return null;
  }
}

function knownProviderBrandUrl(providerId: string) {
  switch (providerId) {
    case "spotify":
      return assetUrl("spotify.png");
    case "apple-music":
      return assetUrl("apple-music.png");
    default:
      return null;
  }
}

function assetUrl(filename: string) {
  return new URL(`../assets/${filename}`, import.meta.url).href;
}
