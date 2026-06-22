import AppKit
import SwiftUI

struct AppIconView: View {
    let bundleId: String
    var size: CGFloat = 24
    @State private var image: NSImage?

    var body: some View {
        Group {
            if let image {
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
        .task(id: bundleId) {
            image = AppIconCache.shared.cachedImage(for: bundleId)
            guard image == nil else { return }
            guard let loadedImage = await AppIconLoader.loadAsync(bundleId: bundleId) else { return }
            AppIconCache.shared.store(loadedImage, for: bundleId)
            image = loadedImage
        }
    }
}

@MainActor
final class AppIconCache {
    static let shared = AppIconCache()

    private let cache = NSCache<NSString, NSImage>()

    func cachedImage(for bundleId: String) -> NSImage? {
        let key = bundleId as NSString
        return cache.object(forKey: key)
    }

    func store(_ image: NSImage, for bundleId: String) {
        cache.setObject(image, forKey: bundleId as NSString)
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
