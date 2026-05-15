import SwiftUI

struct LabeledField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
            TextField(title, text: $text)
                .textFieldStyle(.roundedBorder)
        }
    }
}

struct LabeledSecureField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
            SecureField(title, text: $text)
                .textFieldStyle(.roundedBorder)
        }
    }
}

struct NumericField: View {
    let title: String
    let unit: String
    @Binding var value: Int

    var body: some View {
        HStack(alignment: .center, spacing: 18) {
            Text(title)
                .font(.headline)
            Spacer()
            TextField(title, value: $value, format: .number)
                .textFieldStyle(.roundedBorder)
                .frame(width: 110)
                .multilineTextAlignment(.trailing)
            Text(unit)
                .font(.headline.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }
}
