require('dotenv').config();
const edge = require('edge-js');
const { createClient } = require('@supabase/supabase-js');
const EscPosEncoder = require('esc-pos-encoder');

// --- C# Printer Interop Code ---
const printerInteropCode = `
using System;
using System.Threading.Tasks;
using System.Management; // Requires System.Management.dll
using System.Runtime.InteropServices;
using System.IO;

public class Startup
{
    // P/Invoke for Raw Printing
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    // Method to Discover EPSON USB Printer via WMI
    public async Task<object> DiscoverPrinter(object input)
    {
        string printerName = null;
        try 
        {
            // Query WMI for Printers
            var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_Printer");
            foreach (ManagementObject printer in searcher.Get())
            {
                string name = printer["Name"]?.ToString();
                string portName = printer["PortName"]?.ToString();

                if (!string.IsNullOrEmpty(name) && !string.IsNullOrEmpty(portName))
                {
                    // Check for EPSON and USB
                    if (name.ToUpper().Contains("EPSON") && portName.ToUpper().StartsWith("USB"))
                    {
                        printerName = name;
                        break; // Found it
                    }
                }
            }
        }
        catch (Exception ex)
        {
            return "Error: " + ex.Message;
        }

        return printerName; // Returns null if not found
    }

    // Method to Print Raw Bytes
    public async Task<object> PrintRaw(dynamic input)
    {
        string printerName = (string)input.printerName;
        string base64Data = (string)input.data;
        byte[] rawData = Convert.FromBase64String(base64Data);

        IntPtr hPrinter = new IntPtr(0);
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "Mitake Ticket";
        di.pDataType = "RAW";

        try
        {
            if (OpenPrinter(printerName.Normalize(), out hPrinter, IntPtr.Zero))
            {
                if (StartDocPrinter(hPrinter, 1, di))
                {
                    if (StartPagePrinter(hPrinter))
                    {
                        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(rawData.Length);
                        Marshal.Copy(rawData, 0, pUnmanagedBytes, rawData.Length);
                        int dwWritten;
                        WritePrinter(hPrinter, pUnmanagedBytes, rawData.Length, out dwWritten);
                        Marshal.FreeCoTaskMem(pUnmanagedBytes);
                        EndPagePrinter(hPrinter);
                    }
                    EndDocPrinter(hPrinter);
                }
                ClosePrinter(hPrinter);
                return true;
            }
            else 
            {
                return false;
            }
        }
        catch (Exception ex)
        {
            return "Error: " + ex.Message;
        }
    }
}
`;

// --- Node.js Logic ---

async function main() {
    console.log("🍜 Mitake Middleware Starting...");

    // 1. Check Environment Variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error("❌ Error: SUPABASE_URL and SUPABASE_KEY must be set in .env file.");
        process.exit(1);
    }

    // 2. Discover Printer
    console.log("🔍 Searching for EPSON USB Printer...");
    const discoverPrinter = edge.func({
        source: printerInteropCode,
        references: ['System.Management.dll']
    });

    let printerName = null;
    try {
        printerName = await discoverPrinter(null);
    } catch (e) {
        console.error("❌ Error discovering printer:", e);
    }

    if (!printerName) {
        console.error("❌ No EPSON USB printer found. Please check connection.");
        // We don't exit here, maybe they plug it in later? 
        // For now, let's just warn. Realtime will still listen but print will fail.
    } else {
        console.log(`✅ Printer Found: ${printerName}`);
    }

    // 3. Connect to Supabase
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log("✅ Connected to Supabase. Listening for orders...");

    // 4. Listen for Realtime Events
    supabase
        .channel('orders-channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
            console.log("🔔 New Order Received:", payload.new.id);
            await handleNewOrder(payload.new, printerName);
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log("📡 Realtime subscription active.");
            }
        });
}

async function handleNewOrder(order, printerName) {
    if (!printerName) {
        console.error("⚠️ Cannot print: No printer detected.");
        return;
    }

    console.log(`🧾 Processing Order: ${order.order_number || order.id}`);

    // --- Safe Parsing Logic ---
    let items = [];
    let customerInfo = {};

    try {
        // Parse Items
        if (typeof order.items === 'string') {
            try {
                items = JSON.parse(order.items);
                // Handle double-encoding if necessary
                if (typeof items === 'string') {
                    items = JSON.parse(items);
                }
            } catch (e) {
                console.error("❌ Failed to parse 'items' JSON:", e);
                items = [];
            }
        } else if (Array.isArray(order.items)) {
            items = order.items;
        }

        // Parse Customer Info
        if (typeof order.customer_info === 'string') {
            try {
                customerInfo = JSON.parse(order.customer_info);
                if (typeof customerInfo === 'string') {
                    customerInfo = JSON.parse(customerInfo);
                }
            } catch (e) {
                console.error("❌ Failed to parse 'customer_info' JSON:", e);
                customerInfo = {};
            }
        } else if (typeof order.customer_info === 'object') {
            customerInfo = order.customer_info || {};
        }

    } catch (globalParseErr) {
        console.error("❌ Critical Error during data parsing:", globalParseErr);
        return; // Stop to prevent crash
    }

    try {
        // 5. Generate ESC/POS Data
        const encoder = new EscPosEncoder();
        let ticket = encoder
            .initialize()
            .align('center')
            .line('MITAKE RAMEN')
            .line('--------------------------------')
            .align('left')
            .line(`Order: ${order.order_number || order.id}`)
            .line(`Date: ${new Date().toLocaleString()}`)
            .line('--------------------------------');

        // Customer Info (if available)
        if (customerInfo && (customerInfo.name || customerInfo.phone)) {
            if (customerInfo.name) ticket.line(`Client: ${customerInfo.name}`);
            if (customerInfo.phone) ticket.line(`Tel: ${customerInfo.phone}`);
            ticket.line('--------------------------------');
        }

        if (Array.isArray(items) && items.length > 0) {
            items.forEach(item => {
                const price = item.price ? parseFloat(item.price).toFixed(2) : "0.00";
                ticket.line(`${item.quantity}x ${item.name} - ${price}€`);
                if (item.options && item.options.length > 0) {
                    item.options.forEach(opt => {
                        ticket.line(`  + ${opt}`);
                    });
                }
            });
        } else {
            ticket.line("No items found or parse error.");
        }

        ticket
            .line('--------------------------------')
            .align('right')
            .line(`TOTAL: ${order.total_price}€`)
            .newline()
            .newline()
            .cut();

        const rawData = ticket.encode();
        const base64Data = Buffer.from(rawData).toString('base64');

        // 6. Print via C#
        const printRaw = edge.func({
            source: printerInteropCode,
            references: ['System.Management.dll']
        });

        console.log("🖨️ Printing ticket...");
        const result = await printRaw({ printerName: printerName, data: base64Data });

        if (result === true) {
            console.log("✅ Print successful.");
        } else {
            console.error("❌ Print failed:", result);
        }

    } catch (err) {
        console.error("❌ Error processing order:", err);
    }
}

main();
