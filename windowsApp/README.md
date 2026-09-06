# PulseBar Windows Demo

This is the first Windows UI spike. It is intentionally independent from the Kotlin runtime and uses local demo state only. The current test target is Windows ARM64 only.

## Run on Windows

Requirements:

- Windows 10 version 1809 or later
- Visual Studio 2022 with the .NET desktop development workload
- Windows App SDK tooling

From PowerShell:

```powershell
dotnet restore .\PulseBar.Windows.csproj
dotnet run --project .\PulseBar.Windows.csproj -c Debug -p:Platform=ARM64 -r win-arm64
```

The demo includes local navigation and a connect/disconnect button. The UI boundary is ready for a future runtime adapter; no Kotlin runtime, database, network, or protocol code is loaded yet.

## In-process Kotlin Hello World bridge

The demo contains a deliberately small single-process bridge. IKVM converts the Kotlin/JVM bytecode into a .NET assembly during the WinUI build, and C# calls the generated .NET type directly. It does not start a JVM and does not initialize the existing PulseBar runtime.

From the repository root, build the JAR with the Gradle wrapper:

```powershell
.\\gradlew.bat :common:jvmHelloThinJar
```

Then run the Windows app and click `Call Kotlin hello()`. The WinUI process calls `pulseBarHello()` directly through the IKVM-generated assembly.
