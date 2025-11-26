require('dotenv').config();
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const EscPosEncoder = require('esc-pos-encoder');

// --- PowerShell Helper Functions ---

function executePowershell(command) {
    return new Promise((resolve, reject) => {
        const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);

        let stdout = '';
        let stderr = '';

        ps.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        ps.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ps.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`PowerShell exited with code ${code}. Stderr: ${stderr}`));
            } else {
                resolve(stdout.trim());
            }
        });

        ps.on('error', (err) => {
            reject(err);
        });
    });
}

async function listAllPrinters() {
    console.log("📋 IMPRIMANTES DÉTECTÉES SUR CE PC :");
    const cmd = `Get-Printer | Select Name, PortName, DriverName, PrinterStatus | ConvertTo-Json`;

    try {
        const jsonOutput = await executePowershell(cmd);
        if (!jsonOutput) {
            console.log("⚠️ Aucune imprimante trouvée.");
            return;
        }

        let printers = [];
        try {
            printers = JSON.parse(jsonOutput);
            if (!Array.isArray(printers)) {
                printers = [printers]; // Handle single object case
            }
        } catch (e) {
            console.error("⚠️ Erreur parsing JSON imprimantes:", e.message);
            return;
        }

        console.table(printers.map(p => ({
            Name: p.Name,
            Port: p.PortName,
            Status: p.PrinterStatus
        })));

        console.log("\nℹ️ Pour choisir une imprimante, ajoutez TARGET_PRINTER_NAME=\"Nom Exact\" dans votre fichier .env\n");

    } catch (e) {
        console.error("❌ Erreur lors de la récupération des imprimantes:", e.message);
    }
}

async function findPrinterPowershell() {
    // Priority 1: Check .env
    if (process.env.TARGET_PRINTER_NAME) {
        console.log(`🎯 Configuration manuelle détectée : "${process.env.TARGET_PRINTER_NAME}"`);
        return process.env.TARGET_PRINTER_NAME;
    }

    // Priority 2: Auto-discovery
    console.log("🔍 Recherche automatique d'une imprimante EPSON USB...");
    // Get-WmiObject Win32_Printer | Where-Object { $_.Name -like "*EPSON*" -and $_.PortName -like "USB*" } | Select-Object -ExpandProperty Name
    const cmd = `Get-WmiObject Win32_Printer | Where-Object { $_.Name -like "*EPSON*" -and $_.PortName -like "USB*" } | Select-Object -ExpandProperty Name`;

    try {
        const printerName = await executePowershell(cmd);
        if (printerName) {
            // If multiple printers found, it might return them separated by newlines. Take the first one.
            const firstPrinter = printerName.split('\r\n')[0].trim();
            return firstPrinter;
        }
        return null;
    } catch (e) {
        console.error("❌ Erreur découverte auto:", e.message);
        return null;
    }
}

async function printRawPowershell(printerName, base64Data) {
    console.log(`🖨️ Envoi des données vers : "${printerName}"...`);

    // PowerShell script to load winspool.drv and send bytes
    // We use a Here-String for the C# code
    const psScript = `
$printerName = "${printerName}"
$base64 = "${base64Data}"
$bytes = [Convert]::FromBase64String($base64)

$code = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
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

    public static bool SendBytesToPrinter(string szPrinterName, byte[] pBytes)
    {
        Int32 dwError = 0, dwWritten = 0;
        IntPtr hPrinter = new IntPtr(0);
        DOCINFOA di = new DOCINFOA();
        bool bSuccess = false;

        di.pDocName = "Mitake Ticket";
        di.pDataType = "RAW";

        if (OpenPrinter(szPrinterName.Normalize(), out hPrinter, IntPtr.Zero))
        {
            if (StartDocPrinter(hPrinter, 1, di))
            {
                if (StartPagePrinter(hPrinter))
                {
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(pBytes.Length);
                    Marshal.Copy(pBytes, 0, pUnmanagedBytes, pBytes.Length);
                    bSuccess = WritePrinter(hPrinter, pUnmanagedBytes, pBytes.Length, out dwWritten);
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }
        return bSuccess;
    }
}
"@

Add-Type -TypeDefinition $code
$result = [RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes)
Write-Output $result
`;

    // We pass the script encoded in Base64 to avoid escaping issues with spawn
    const psScriptBase64 = Buffer.from(psScript, 'utf16le').toString('base64');
    const cmd = `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${psScriptBase64}`;

    return new Promise((resolve, reject) => {
        const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', psScriptBase64]);

        let stdout = '';
        let stderr = '';

        ps.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        ps.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ps.on('close', (code) => {
            if (code !== 0) {
                console.error(`PowerShell Error: ${stderr}`);
                resolve(false);
            } else {
                // Check if output contains "True"
                if (stdout.includes("True")) {
                    resolve(true);
                } else {
                    console.error(`PowerShell Output: ${stdout}`);
                    resolve(false);
                }
            }
        });
    });
}

// --- Main Application Logic ---

async function main() {
    console.log("🍜 Mitake Middleware (PowerShell Edition) Starting...");

    // 1. Check Environment Variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error("❌ Error: SUPABASE_URL and SUPABASE_KEY must be set in .env file.");
        process.exit(1);
    }

    // 2. Diagnostic: List all printers
    await listAllPrinters();

    // 3. Discover Printer
    let printerName = await findPrinterPowershell();

    if (!printerName) {
        console.error("❌ Aucune imprimante configurée ou détectée.");
        // We continue anyway, maybe it appears later? But usually we want it at start.
    } else {
        console.log(`✅ Imprimante sélectionnée : "${printerName}"`);
    }

    // 4. Connect to Supabase
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log("✅ Connecté à Supabase. En attente de commandes...");

    // 5. Listen for Realtime Events
    supabase
        .channel('orders-channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
            console.log("🔔 Nouvelle commande reçue :", payload.new.id);

            // Re-check printer if not found initially?
            if (!printerName) {
                printerName = await findPrinterPowershell();
                if (printerName) console.log(`✅ Imprimante trouvée (Tardif) : "${printerName}"`);
            }

            await handleNewOrder(payload.new, printerName);
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log("📡 Abonnement Realtime actif.");
            }
        });
}

async function handleNewOrder(order, printerName) {
    if (!printerName) {
        console.error("⚠️ Impossible d'imprimer : Aucune imprimante détectée.");
        return;
    }

    console.log(`🧾 Traitement de la commande : ${order.order_number || order.id}`);

    // --- Safe Parsing Logic ---
    let items = [];
    let customerInfo = {};

    try {
        // Parse Items
        if (typeof order.items === 'string') {
            try {
                items = JSON.parse(order.items);
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
        return;
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

        // Customer Info
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

        // 6. Print via PowerShell
        const result = await printRawPowershell(printerName, base64Data);

        if (result === true) {
            console.log("✅ Impression réussie.");
        } else {
            console.error("❌ Échec de l'impression.");
        }

    } catch (err) {
        console.error("❌ Erreur traitement commande:", err);
    }
}

main();
