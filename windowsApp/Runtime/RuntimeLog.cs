using System.Diagnostics;

namespace PulseBar.Windows.Runtime;

internal static class RuntimeLog
{
    private static readonly object Gate = new();
    private static readonly string LogPath = InitializeLogPath();

    public static string Path => LogPath;

    public static void Info(string message) => Write("INFO", message);

    public static void Error(string message, Exception? error = null) =>
        Write("ERROR", error is null ? message : $"{message} error={error}");

    private static void Write(string level, string message)
    {
        var line = $"{DateTimeOffset.Now:O} [{level}] {message}";
        Debug.WriteLine(line);
        try
        {
            Console.Error.WriteLine(line);
        }
        catch
        {
        }

        lock (Gate)
        {
            try
            {
                File.AppendAllText(LogPath, line + Environment.NewLine);
            }
            catch (Exception error)
            {
                Debug.WriteLine($"{line} log_write_failed={error.Message}");
            }
        }
    }

    private static string InitializeLogPath()
    {
        try
        {
            var directory = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "PulseBar");
            Directory.CreateDirectory(directory);
            return System.IO.Path.Combine(directory, "windows-runtime.log");
        }
        catch
        {
            return System.IO.Path.Combine(System.IO.Path.GetTempPath(), "pulsebar-windows-runtime.log");
        }
    }
}
