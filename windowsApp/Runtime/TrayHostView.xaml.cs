using H.NotifyIcon;
using Microsoft.UI.Xaml.Controls;

namespace PulseBar.Windows.Runtime;

public sealed partial class TrayHostView : UserControl
{
    public event Action? Initialized;

    public TrayHostView()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private void OnLoaded(object sender, Microsoft.UI.Xaml.RoutedEventArgs args)
    {
        Loaded -= OnLoaded;
        TrayIcon.ForceCreate(enablesEfficiencyMode: true);
        RuntimeLog.Info("tray.initialized provider=H.NotifyIcon host=loaded popup=xaml");
        Initialized?.Invoke();
    }

    public void DisposeTrayIcon() => TrayIcon.Dispose();
}
