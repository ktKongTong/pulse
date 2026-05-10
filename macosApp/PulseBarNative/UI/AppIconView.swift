import AppKit
import SwiftUI

struct AppIconView: View {
    let bundleId: String
    var size: CGFloat = 24

    var body: some View {
        Group {
            if let image = AppIconCache.shared.image(for: bundleId) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFit()
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.secondary.opacity(0.12))
                    .overlay(
                        Image(systemName: "app.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                    )
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

@MainActor
final class AppIconCache {
    static let shared = AppIconCache()

    private let cache = NSCache<NSString, NSImage>()

    func image(for bundleId: String) -> NSImage? {
        let key = bundleId as NSString
        if let image = cache.object(forKey: key) {
            return image
        }
        guard let path = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId)?.path else {
            return nil
        }
        let image = NSWorkspace.shared.icon(forFile: path)
        cache.setObject(image, forKey: key)
        return image
    }
}

struct ProviderIconBadge: View {
    let bundleId: String

    var body: some View {
        AppIconView(bundleId: bundleId, size: 22)
            .background(
                Circle()
                    .fill(Color.white)
                    .frame(width: 24, height: 24)
            )
            .offset(x: -4, y: -4)
    }
}
