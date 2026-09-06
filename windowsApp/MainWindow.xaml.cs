using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using System.Reflection;
using System.Runtime.InteropServices;

namespace PulseBar.Windows;

public sealed partial class MainWindow : Window
{
    private bool _isDemoConnected;

    public MainWindow()
    {
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBarDragRegion);
        NavView.SelectedItem = NavView.MenuItems[0];
        ShowSharedRuntimeResult();
    }

    private void NavView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is not NavigationViewItem item)
        {
            return;
        }

        var tag = item.Tag?.ToString() ?? "Overview";
        PageEyebrow.Text = tag.ToUpperInvariant();
        PageTitle.Text = tag switch
        {
            "Connections" => "Keep every signal close.",
            "Activity" => "See what just happened.",
            "Settings" => "Shape your workspace.",
            _ => "Hello, Windows."
        };
        PageSubtitle.Text = tag switch
        {
            "Connections" => "Endpoint controls will live here once the runtime is connected.",
            "Activity" => "A calm timeline for the signals PulseBar has observed.",
            "Settings" => "Native preferences with shared Kotlin state behind them.",
            _ => "Your PulseBar workspace is ready for its first signal."
        };
    }

    private void ConnectButton_Click(object sender, RoutedEventArgs e)
    {
        _isDemoConnected = !_isDemoConnected;
        ConnectionStatus.Text = _isDemoConnected ? "Connected" : "Not connected";
        ConnectionStatus.Foreground = new SolidColorBrush(
            _isDemoConnected ? global::Windows.UI.Color.FromArgb(255, 92, 120, 32) : global::Windows.UI.Color.FromArgb(255, 180, 119, 37));
        ConnectButton.Content = _isDemoConnected ? "Disconnect demo endpoint" : "Connect demo endpoint";
    }

    private void KotlinHelloButton_Click(object sender, RoutedEventArgs e)
    {
        ShowSharedRuntimeResult();
    }

    private void KotlinNativeHelloButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var pointer = pulsebar_native_hello();
            var output = Marshal.PtrToStringAnsi(pointer)
                ?? throw new InvalidOperationException("Kotlin/Native returned a null string.");
            KotlinHelloResult.Text = $"Kotlin/Native says: {output}";
        }
        catch (Exception error)
        {
            KotlinHelloResult.Text = $"Kotlin/Native call failed: {error.Message}";
        }
    }

    private void ShowSharedRuntimeResult()
    {
        try
        {
            var assemblyPath = Path.Combine(AppContext.BaseDirectory, "PulseBar.Shared.dll");
            var assembly = Assembly.LoadFrom(assemblyPath);
            var bridgeType = assembly.GetType("io.github.kt.pulsebar.export.PulseBarBridge");
            if (bridgeType is null)
            {
                throw new InvalidOperationException("PulseBarBridge was not found in the shared assembly.");
            }

            var bridge = Activator.CreateInstance(bridgeType, new object?[] { null });
            KotlinHelloResult.Text = bridge is null
                ? "Shared runtime returned no bridge instance."
                : $"Shared runtime attached: {bridgeType.FullName}";
        }
        catch (Exception error)
        {
            var cause = error;
            while (cause.InnerException is not null)
            {
                cause = cause.InnerException;
            }
            KotlinHelloResult.Text = $"Shared runtime call failed: {cause.GetType().Name}: {cause.Message}";
        }
    }

    [DllImport("PulseBar.NativeHello.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern nint pulsebar_native_hello();
}
