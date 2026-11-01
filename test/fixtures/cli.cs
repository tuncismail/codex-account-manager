using System;
using System.Diagnostics;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public static class FixtureCli
{
    public static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.InputEncoding = new UTF8Encoding(false);
        if (args.Length > 0 && args[0] == "hold")
        {
            Console.WriteLine(Process.GetCurrentProcess().Id);
            Console.Out.Flush();
            Thread.Sleep(30000);
            return 0;
        }
        Console.WriteLine(new JavaScriptSerializer().Serialize(new {
            home = Environment.GetEnvironmentVariable("CODEX_HOME"),
            arguments = args,
            input = Console.ReadLine()
        }));
        Console.Error.WriteLine("fixture stderr");
        return args.Length > 0 && args[0] == "exit-seven" ? 7 : 0;
    }
}
