using System;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using PulseBar.Windows.Runtime;

namespace PulseBar.Windows;

public partial class App : Application
{
    private Window? _trayHostWindow;
    private TrayHostView? _trayHostView;

    public App()
    {
        AppDomain.CurrentDomain.UnhandledException += (_, eventArgs) =>
        {
            if (eventArgs.ExceptionObject is Exception error)
            {
                RuntimeLog.Error("app.unhandled_exception", error);
            }
        };
        TaskScheduler.UnobservedTaskException += (_, eventArgs) =>
        {
            RuntimeLog.Error("app.unobserved_task_exception", eventArgs.Exception);
            eventArgs.SetObserved();
        };
        UnhandledException += (_, eventArgs) => RuntimeLog.Error("app.xaml_unhandled_exception", eventArgs.Exception);
        AppDomain.CurrentDomain.ProcessExit += (_, _) => _trayHostView?.DisposeTrayIcon();

        RuntimeLog.Info("app.constructing");
        InitializeComponent();
        RuntimeLog.Info("app.initialized");
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        RuntimeLog.Info($"app.launched arguments={args.Arguments ?? string.Empty}");

        _trayHostView = new TrayHostView();
        _trayHostView.Initialized += HideTrayHostWindow;
        _trayHostWindow = new Window { Content = _trayHostView };
        _trayHostWindow.AppWindow.IsShownInSwitchers = false;
        _trayHostWindow.Activate();
    }

    private void HideTrayHostWindow()
    {
        _trayHostWindow?.AppWindow.Hide();
        RuntimeLog.Info("tray.host.hidden");
    }
}
