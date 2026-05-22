import appIconMap from "./app-icon.json";

type AppIconEntry = {
  logo: string;
  macos?: string;
};

type AppIconManifest = Record<string, AppIconEntry>;

const appIconLookup = createAppIconLookup(appIconMap as AppIconManifest);

export function resolveAppIconAssetUrl(appId: string) {
  return appIconLookup.get(appId) ?? null;
}

function createAppIconLookup(manifest: AppIconManifest) {
  const lookup = new Map<string, string>();

  for (const entry of Object.values(manifest)) {
    const bundleId = entry.macos?.trim();
    if (!bundleId) continue;
    lookup.set(bundleId, `/brand-assets/${entry.logo}`);
  }

  return lookup;
}
