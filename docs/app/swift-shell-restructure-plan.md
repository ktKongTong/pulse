# PulseBarNative Swift Shell Restructure Plan

Companion to `docs/app/refactor-plan.md`. The cross-language refactor (Kotlin owns schema, logic, presentation helpers) is done. What's left on the Swift side is a single flat folder with nine files and mixed responsibilities. This plan is about making that shell readable and navigable without changing behaviour.

## 1. Where the Swift shell is today

```
macosApp/PulseBarNative/
├── PulseBarNativeApp.swift            199   App entry + NSStatusItem controller
├── PulseNativeLog.swift                44   os.Logger wrapper
├── Models.swift                        78   DashboardSection + Kotlin-type adapters
├── NativeMonitorModel.swift           280   ObservableObject holding every Published state
├── NativeSettingsView.swift           928   Dashboard + ConnectionPane + Reporting + Settings + ConnectionRuntimeStatus helpers + form primitives
├── MenuBarContentView.swift           581   Menubar panel + UsageRow + MediaCard + SeekBar + AppIconCache + pulseClock
├── LiveListenCaptureView.swift        446   Live Listen dashboard tab
├── LiveListenCaptureModel.swift       639   LiveListenBridge protocol + capture coordinator + status structs + permission enums
└── LiveListenCaptureService.swift     610   CoreAudio process-tap + TCC permission + WAV writer
Total                                3,805
```

### Readability problems

1. **Nine files, no folders.** "Where do I edit the endpoint editor?" means opening four files (`NativeSettingsView`, `NativeMonitorModel`, `Models`, `PulseBarConfigDraft` on the Kotlin side) and scanning for types.

2. **`NativeSettingsView.swift` is a junk drawer.** One file holds: the split-view navigation shell, connection pane + detail + list item + editor sheet, reporting pane + list item + detail + app catalog, global settings pane, `ConnectionRuntimeStatus` typealias + extension + resolver, and all the form primitives (`DetailSection`, `KeyValueGrid`, `LabeledField`, `LabeledSecureField`, `NumericField`). None of these reference each other cross-scope in a meaningful way.

3. **`MenuBarContentView.swift` mixes view + "lib".** Alongside `MenuBarContentView` it declares `PulseBarCurrentAppCard`, `PulseBarMediaCard`, `MediaSeekBar`, `MarqueeText`, `ProviderIconBadge`, `AppIconView`, `AppIconCache`, `MediaTransportButton`, `PulseBarIconButton`, `focusPulseBarDashboardWindow()`, and the top-level `pulseClock()` / `pulseProgressText()` functions. Most of these are reusable UI primitives, not menubar-specific.

4. **`LiveListenCaptureModel.swift` has three distinct concerns glued together.**
   - The `LiveListenBridge` protocol + `PulseBarBridge` adapter (bridging layer).
   - The `LiveListenCaptureModel` ObservableObject (~500 lines of server-driven capture orchestration with five `@Published` fields, three `Task`s, four entry-point `start*` methods plus their tails).
   - Trailing types: `LiveListenEndpointPublisherStatus`, `LiveListenMediaStreamPermission`, `LiveListenMediaPlaybackStatus`.

5. **`NativeMonitorModel` is the only ObservableObject fan-out.** Every SwiftUI view reads the same monolithic model. Touching one published field forces re-render re-evaluations across unrelated panes (menubar, settings, live listen). The model also holds `liveListenCaptureModel` as a child ObservableObject, so Live Listen state updates propagate up through the parent object. Nothing is actually wrong, but the dependency graph is implicit.

6. **Naming inconsistency.** `NativeMonitorModel` / `NativeSettingsView` / `PulseBarDashboardView` / `PulseBarNativeApp` / `LiveListenCaptureModel`. Three prefix conventions coexist. Type discovery suffers.

7. **No discoverable map from Kotlin type to Swift adapter.** If you want to know "what does Swift add to `PulseBarLiveListenStats`?" you have to grep three files (`Models.swift`, `LiveListenCaptureModel.swift`, `LiveListenCaptureView.swift`).

8. **Form primitives reinvented inline.** `LabeledField` / `LabeledSecureField` / `NumericField` / `DetailSection` / `KeyValueGrid` each sit `private struct` inside `NativeSettingsView.swift` — preventing reuse from other panes and burying the shared visual vocabulary.

None of this is a bug. All of it adds up to "new reader has to load the entire shell into their head before making any change."

## 2. Target layout

```
macosApp/PulseBarNative/
├── App/
│   ├── PulseBarNativeApp.swift             App + @NSApplicationDelegateAdaptor
│   ├── StatusItemController.swift          NSStatusItem + NSPanel + NSMenu lifecycle
│   └── WindowHelpers.swift                 focusPulseBarDashboardWindow()
├── State/
│   ├── NativeMonitorModel.swift            Bridge subscription fan-out (ObservableObject)
│   ├── MonitorBridgeSubscriptions.swift    nonisolated subscribe* helpers
│   └── DashboardSection.swift              SwiftUI navigation enum
├── Bridge/
│   ├── KotlinTypeAdapters.swift            Identifiable + Sendable + artworkURL + ConnectionRuntimeStatus + resolveConnectionStatus
│   └── PulseNativeLog.swift                os.Logger wrapper (unchanged)
├── Menubar/
│   └── MenuBarContentView.swift            Menubar panel body only
├── Dashboard/
│   ├── PulseBarDashboardView.swift         Split view + navigation
│   ├── Connection/
│   │   ├── ConnectionPane.swift
│   │   ├── ConnectionListItem.swift
│   │   ├── ConnectionDetailPane.swift
│   │   ├── EndpointEditorSheet.swift
│   │   └── EmptyConnectionPane.swift
│   ├── Reporting/
│   │   ├── ReportingPane.swift
│   │   ├── InstalledReportingApp.swift
│   │   └── InstalledAppCatalog.swift
│   └── Settings/
│       └── GlobalSettingsPane.swift
├── LiveListen/
│   ├── LiveListenCaptureModel.swift        ObservableObject only
│   ├── LiveListenBridge.swift              protocol + PulseBarBridge extension
│   ├── LiveListenCaptureService.swift      CoreAudio + TCC + WAV (unchanged)
│   ├── LiveListenTypes.swift               LiveListenEndpointPublisherStatus + Permission/Playback enums + LiveListenCaptureSource/Meter/Update
│   └── LiveListenCaptureView.swift         Dashboard tab view
└── UI/
    ├── AppIconView.swift                   + AppIconCache
    ├── MediaSeekBar.swift
    ├── MarqueeText.swift
    ├── ProviderIconBadge.swift
    ├── MediaGlassBackground.swift
    ├── Buttons.swift                       MediaTransportButton + PulseBarIconButton
    ├── Forms.swift                         LabeledField + LabeledSecureField + NumericField
    ├── DetailSection.swift                 + KeyValueGrid
    └── MediaCards.swift                    PulseBarCurrentAppCard + PulseBarMediaCard + pulseClock/pulseProgressText free functions
```

Lines don't change; everything moves to a home where `⌘⇧O` finds it by name.

### Why this shape

- **Feature folders over type folders.** `Dashboard/Connection/` beats `Views/` + `ViewModels/` for a SwiftUI app this size; reorganisations affect three or four contiguous files instead of scattering across horizontal slabs.
- **`App/` = platform shell only.** Entry point, status item, window plumbing. Nothing feature-specific.
- **`State/` = single source of truth glue.** The Kotlin→Swift subscription fan-out lives here alone. SwiftUI views read from published properties; they don't reach into this folder.
- **`Bridge/` = Kotlin adapters + logging.** Everything that exists because of Kotlin interop (and only because of Kotlin interop) collects here. Reviewing the KT-83730 workaround means opening one file.
- **`LiveListen/` is its own vertical.** Capture service + model + bridge + view + types in one folder lets the existing 600-line service sit next to the model that drives it.
- **`UI/` = reusable primitives.** Pure presentation components with no business dependency. Everything else imports them.

## 3. Migration plan

### Phase S1: Split folders, zero logic changes

This phase is pure file moves + cut/paste within files. No behaviour delta.

1. Create the folder structure above.
2. For each existing file: split into the files listed under it in §2 and move them to the target folders. Preserve `private struct` / `private enum` scoping; a former `private struct` that now lives in its own file becomes `struct` at file scope and stays `internal`.
3. Update the Xcode project (`macosApp/project.yml`) to add the new folders + files. Run the project regeneration step.
4. No import changes needed (single module app). No access-level changes beyond `private struct` → `struct`.
5. Hook: `rm -rf macosApp/.xcode-derived && xcodebuild ...` + `scripts/check-pulse.sh` passes, tag `shell-restructure/s1-complete`.

**Risk**: Xcode project regeneration churn. Keep the diff small by generating the project once, then committing the result. Do **not** touch any `.swift` content beyond moving + re-scoping.

### Phase S2: Split NativeMonitorModel into feature-scoped state

`NativeMonitorModel` is 280 lines today. Ten `@Published` properties, five subscribe closures, endpoint mutation commands, Live Listen delegation, and bridge lifecycle all coexist. Break it up without changing the SwiftUI interface.

Target: three ObservableObjects behind a single shell facade, all injected through the same environment object tree.

```swift
// State/MonitorStore.swift — bridge lifecycle + subscription fan-out
@MainActor
final class MonitorStore: ObservableObject {
    let bridge: PulseBarBridge
    let snapshot: SnapshotStore
    let sync: SyncStore
    let interaction: InteractionStore
    let usage: UsageStore
    let settings: SettingsStore
    let liveListen: LiveListenCaptureModel
    private var cancellables: [PulseBarCancellable] = []
    // start() / stop() / subscribe* helpers move here.
}

// State/SnapshotStore.swift
// State/SyncStore.swift
// State/InteractionStore.swift
// State/UsageStore.swift
// State/SettingsStore.swift  — wraps PulseBarConfigDraft + connectingEndpointIDs + endpoint commands
```

SwiftUI views move from `@EnvironmentObject private var monitor: NativeMonitorModel` to e.g. `@EnvironmentObject private var settings: SettingsStore` — only the panes that actually bind to those fields subscribe to them, so SwiftUI re-render scope shrinks.

The existing `NativeMonitorModel` name is dropped. Views that used to read `monitor.snapshot` now read `snapshot.current`, `monitor.syncState?.endpoints` becomes `sync.state?.endpoints`, and endpoint mutation commands (`addEndpoint`, `removeEndpoint`, `setEndpointEnabled`, `connectEndpoint`, `disconnectEndpoint`, `saveConfig`) live on `SettingsStore`.

Tag: `shell-restructure/s2-complete`.

### Phase S3: Live Listen model diet

`LiveListenCaptureModel` is 639 lines; 400 of them are the `startServerDrivenCapture` / `startCaptureOnly` / `startNativeStream` triplet plus their shared meter-task tail. These three entry points share 80% of their bodies.

Extract:

- `LiveListenCaptureSession` — a small actor / helper that owns the `meterTask: Task`, takes a `source`, optional `outputURL`, optional `seconds`, and a PCM handler; runs the meter-yield loop; calls the model's delegate on start / tick / finish / fail. The model becomes a coordinator that decides *which* mode to enter; the session is the implementation.
- Move `LiveListenEndpointPublisherStatus`, `LiveListenMediaStreamPermission`, `LiveListenMediaPlaybackStatus` into `LiveListen/LiveListenTypes.swift` (already in Phase S1 layout, but the type split makes that move meaningful).

After S3 the model should be ~350 lines and read top-to-bottom as "lifecycle → stats application → commands → helpers".

Tag: `shell-restructure/s3-complete`.

### Phase S4: Naming pass

1. Rename `NativeSettingsView` → `SettingsView` (file-scope; exported only through `PulseBarDashboardView`).
2. Drop the `Native*` prefix globally. `NativeMonitorModel` already went away in Phase S2.
3. Standardise on `PulseBar*` for top-level exported scenes (`PulseBarDashboardView`, `PulseBarMediaCard`) and plain names for feature-internal types (`ConnectionPane`, `SettingsStore`).
4. `focusPulseBarDashboardWindow()` → `Window.focusDashboard()` (typed as a namespace).

Tag: `shell-restructure/s4-complete`.

### Phase S5: Sendable + concurrency hygiene

Three spots currently mark `@unchecked Sendable` or use `DispatchQueue.main.async { MainActor.assumeIsolated { ... } }`:

- `PulseBarBridge: @retroactive @unchecked Sendable`
- `PulseBarLiveListenStats / PulseBarMedia / PulseBarSnapshot: @retroactive @unchecked Sendable`
- The subscribe helpers in `MonitorStore` (previously in `NativeMonitorModel`)

With `State/MonitorBridgeSubscriptions.swift` isolated in its own file, the Kotlin-interop concurrency ceremony becomes inspectable in one place. Audit whether each `@unchecked` is still necessary after KT-83730 is fixed upstream (probably not for enums; class Sendability is still required until Swift Export emits them as `final`+stored-let-only).

No tag — this is maintenance.

## 4. What this plan explicitly does NOT do

- No Kotlin changes. The cross-language refactor is settled; this is Swift-side organisation only.
- No new features. Every file emerges with the same public surface it entered with (allowing for the Phase S2 `EnvironmentObject` type swap).
- No animation / layout work. Visual output is identical.
- No test scaffolding. Swift tests for a menubar app with heavy AppKit integration carry a poor ROI — the Kotlin `:common:jvmTest` suite stays the primary harness.
- No Package.swift / SPM reshape. Single-target app stays single target.

## 5. Acceptance

Each phase:

- `rm -rf macosApp/.xcode-derived && xcodebuild ... build` → `** BUILD SUCCEEDED **`
- `./gradlew :common:jvmTest` → `BUILD SUCCESSFUL`
- `scripts/check-pulse.sh` → `ALIVE pid=...`
- A tag `shell-restructure/s{N}-complete` that's cleanly revertable if the next phase regresses.

After all five phases:

- No Swift file over ~300 lines.
- `⌘⇧O ConnectionPane` → one hit, and it's in `Dashboard/Connection/`.
- `ObservableObject` fan-out clearly tied to feature folder.
- Reading Models.swift / `KotlinTypeAdapters.swift` / `LiveListenBridge.swift` together gives a complete picture of "what Swift adds on top of the Kotlin export surface".

## 6. Sequencing vs `refactor-plan.md`

`refactor-plan.md` Phase 3 (query/command split in Kotlin) and this Swift restructure are orthogonal. Prefer to finish Phase 3 first so the Swift stores in Phase S2 can be designed around the final Kotlin bridge API instead of the current `tick()`-entangled one. If Phase 3 slips, S1 (pure moves) is still safe to run independently and locks in the navigability win early.
