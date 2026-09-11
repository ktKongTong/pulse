using Microsoft.UI.Xaml.Controls;

namespace PulseBar.Windows.Runtime;

public sealed partial class StatusPopover : UserControl
{
    public StatusPopover()
    {
        InitializeComponent();
        Loaded += (_, _) => RuntimeLog.Info("tray.popup.content_loaded");
    }
}
