import SwiftUI

struct DetailSection<Content: View>: View {
    let title: String
    let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.title3.weight(.semibold))
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct KeyValueGrid: View {
    let rows: [(String, String)]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(rows, id: \.0) { row in
                HStack(alignment: .top, spacing: 18) {
                    Text(row.0)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                        .frame(width: 130, alignment: .leading)
                    Text(row.1)
                        .font(.subheadline)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}
