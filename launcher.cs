using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

// A native executable is required: Node cannot spawn a .cmd file as Codex's CLI
// on Windows. Keep stdout exclusively for Codex's JSON-RPC protocol.
public static class CodexProfileLauncher
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")]
    static extern bool SetInformationJobObject(IntPtr job, int type, IntPtr info, uint size);
    [DllImport("kernel32.dll")]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern uint GetLongPathName(string shortPath, StringBuilder longPath, uint capacity);

    static string CanonicalPath(string value)
    {
        string full = Path.GetFullPath(value);
        var buffer = new StringBuilder(32768);
        return GetLongPathName(full, buffer, (uint)buffer.Capacity) != 0 ? buffer.ToString() : full;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits
    {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    static IntPtr CreateChildJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new IOException("Cannot create Codex process job.");
        var limits = new ExtendedLimits();
        limits.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        int size = Marshal.SizeOf(limits);
        IntPtr memory = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(limits, memory, false);
            if (!SetInformationJobObject(job, 9, memory, (uint)size))
            {
                CloseHandle(job);
                throw new IOException("Cannot configure Codex process job.");
            }
            return job;
        }
        finally { Marshal.FreeHGlobal(memory); }
    }

    // Windows CommandLineToArgvW quoting, including quotes and trailing slashes.
    static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') result.Append('\\', slashes * 2 + 1).Append('"');
            else result.Append('\\', slashes).Append(c);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    static async Task Relay(Stream source, Stream destination)
    {
        var buffer = new byte[8192];
        int count;
        while ((count = await source.ReadAsync(buffer, 0, buffer.Length)) != 0)
        {
            await destination.WriteAsync(buffer, 0, count);
            await destination.FlushAsync();
        }
    }

    public static int Main(string[] args)
    {
        IntPtr job = IntPtr.Zero;
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            var config = new JavaScriptSerializer().Deserialize<Dictionary<string, string>>(
                File.ReadAllText(Path.Combine(root, "profile.json"), Encoding.UTF8));
            string home = config["home"], executable = config["executable"];
            if (!Path.IsPathRooted(home) || !Directory.Exists(home)) throw new IOException("Selected Codex profile directory is missing.");
            if (!File.Exists(executable)) throw new IOException("Bundled Codex CLI is missing. Reopen VS Code after updating Codex.");
            if (string.Equals(CanonicalPath(executable), CanonicalPath(System.Reflection.Assembly.GetExecutingAssembly().Location), StringComparison.OrdinalIgnoreCase)) throw new IOException("The Codex launcher cannot launch itself.");
            var quoted = new List<string>();
            foreach (string arg in args) quoted.Add(Quote(arg));
            var start = new ProcessStartInfo(executable, string.Join(" ", quoted));
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardInput = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.EnvironmentVariables["CODEX_HOME"] = home;
            job = CreateChildJob();
            using (var child = Process.Start(start))
            {
                if (!AssignProcessToJobObject(job, child.Handle))
                {
                    child.Kill();
                    throw new IOException("Cannot attach Codex to its window lifecycle.");
                }
                // Log paths and PIDs only; never authentication data or protocol payloads.
                try
                {
                    string log = Path.Combine(root, "launch.log");
                    if (File.Exists(log) && new FileInfo(log).Length > 1048576) File.WriteAllText(log, "");
                    File.AppendAllText(log, DateTime.UtcNow.ToString("o") + " pid=" + child.Id + " home=" + home + Environment.NewLine);
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
                Task input = Task.Run(async () => {
                    try { await Relay(Console.OpenStandardInput(), child.StandardInput.BaseStream); } catch (IOException) { }
                    finally { try { child.StandardInput.Close(); } catch (IOException) { } }
                });
                Task output = Relay(child.StandardOutput.BaseStream, Console.OpenStandardOutput());
                Task error = Relay(child.StandardError.BaseStream, Console.OpenStandardError());
                child.WaitForExit();
                Task.WaitAll(output, error);
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Codex Account Manager: " + error.Message);
            return 1;
        }
        finally { if (job != IntPtr.Zero) CloseHandle(job); }
    }
}
