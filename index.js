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
    // Support Imprimante Virtuelle (Microsoft Print to PDF)
    if (printerName.toUpperCase().includes("PDF")) {
        console.log("📝 [SIMULATION] Impression du ticket (Imprimante Virtuelle PDF détectée)...");
        return true;
    }

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

    // 2. DIAGNOSTIC SYSTÈME - RECHERCHE IMPRIMANTES
    console.log("------------------------------------------------");
    console.log("🔍 DIAGNOSTIC SYSTÈME - RECHERCHE IMPRIMANTES");
    console.log("------------------------------------------------");

    let printerName = null;
    let availablePrinters = [];

    // Commande PowerShell pour lister TOUTES les imprimantes visibles
    const listCmd = `Get-Printer | Select Name, PortName, DriverName, PrinterStatus | ConvertTo-Json`;

    try {
        const output = await executePowershell(listCmd);
        if (output) {
            const parsed = JSON.parse(output);
            // Gestion cas imprimante unique (objet) vs multiples (array)
            availablePrinters = Array.isArray(parsed) ? parsed : [parsed];

            console.table(availablePrinters.map(p => ({ Nom: p.Name, Port: p.PortName, Statut: p.PrinterStatus })));
            console.log("✅ SUCCÈS : PowerShell a réussi à interroger le Spooler Windows.");
        } else {
            console.log("⚠️ Aucune imprimante trouvée (Output vide).");
        }
    } catch (e) {
        console.error("❌ ÉCHEC CRITIQUE : Impossible de lister les imprimantes.", e);
    }
    console.log("------------------------------------------------");

    // 3. Logique de sélection des imprimantes (DUAL PRINTER)
    let kitchenPrinter = process.env.PRINTER_KITCHEN_NAME;
    let cashierPrinter = process.env.PRINTER_CASHIER_NAME;

    if (kitchenPrinter && cashierPrinter) {
        console.log(`🎯 Configuration Multi-Imprimantes détectée :`);
        console.log(`   👨‍🍳 Cuisine : "${kitchenPrinter}"`);
        console.log(`   💰 Caisse  : "${cashierPrinter}"`);
    } else {
        console.log("⚠️ Configuration incomplète dans .env (PRINTER_KITCHEN_NAME / PRINTER_CASHIER_NAME).");
        console.log("🔍 Recherche automatique d'une imprimante de secours (Fallback)...");

        // Fallback: Auto-discovery
        const epsonPrinter = availablePrinters.find(p => p.Name && p.Name.toUpperCase().includes("EPSON"));
        const fallbackPrinter = epsonPrinter ? epsonPrinter.Name : (availablePrinters[0] ? availablePrinters[0].Name : null);

        if (fallbackPrinter) {
            console.log(`✅ Imprimante de secours trouvée : "${fallbackPrinter}"`);
            if (!kitchenPrinter) {
                kitchenPrinter = fallbackPrinter;
                console.log(`   👨‍🍳 Cuisine (Fallback) : "${kitchenPrinter}"`);
            }
            if (!cashierPrinter) {
                cashierPrinter = fallbackPrinter;
                console.log(`   💰 Caisse (Fallback)  : "${cashierPrinter}"`);
            }
        } else {
            console.error("❌ AUCUNE IMPRIMANTE DÉTECTÉE. L'impression échouera.");
        }
    }

    // 4. Connect to Supabase
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log("✅ Connecté à Supabase. En attente de commandes...");

    // 5. Polling Fallback Mechanism (CRITIQUE)
    // Fonction pour vérifier les commandes en attente (au cas où le Realtime échoue)
    async function pollPendingOrders() {
        if (!kitchenPrinter && !cashierPrinter) return;

        try {
            const { data: orders, error } = await supabase
                .from('orders')
                .select('*')
                .eq('status', 'pending_print');

            if (error) {
                console.error("❌ Erreur Polling Supabase:", error.message);
                return;
            }

            if (orders && orders.length > 0) {
                for (const order of orders) {
                    console.log(`🔄 Commande récupérée par Polling: ${order.id}`);

                    // 1. LOCK
                    const { error: updateError } = await supabase
                        .from('orders')
                        .update({ status: 'printing' })
                        .eq('id', order.id);

                    if (updateError) {
                        console.error(`❌ Erreur lock (printing) commande ${order.id}:`, updateError.message);
                        continue;
                    }

                    // 2. PRINT (Dual)
                    await handleNewOrder(order, kitchenPrinter, cashierPrinter);

                    // 3. FINALIZE
                    const { error: finalError } = await supabase
                        .from('orders')
                        .update({ status: 'printed' })
                        .eq('id', order.id);

                    if (finalError) {
                        console.error(`⚠️ Erreur update final (printed) commande ${order.id}:`, finalError.message);
                    } else {
                        console.log(`✅ Commande ${order.id} marquée comme 'printed'.`);
                    }
                }
            }
        } catch (err) {
            console.error("❌ Erreur inattendue dans la boucle de polling:", err);
        }
    }

    // Lancer le polling au démarrage
    await pollPendingOrders();

    // Lancer le polling toutes les 5 secondes
    setInterval(() => {
        pollPendingOrders();
    }, 5000);
    console.log("⏱️ Mode Polling activé (Vérification toutes les 5s).");


    // 6. Listen for Realtime Events
    supabase
        .channel('orders-channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
            console.log("🔔 Realtime: Nouvelle commande reçue :", payload.new.id);

            if (!kitchenPrinter && !cashierPrinter) {
                console.error("⚠️ Impossible d'imprimer : Pas d'imprimante définie.");
                return;
            }

            // Lock Realtime
            const { error: updateError } = await supabase
                .from('orders')
                .update({ status: 'printing' })
                .eq('id', payload.new.id);

            if (!updateError) {
                await handleNewOrder(payload.new, kitchenPrinter, cashierPrinter);

                // Finalize Realtime
                await supabase
                    .from('orders')
                    .update({ status: 'printed' })
                    .eq('id', payload.new.id);
            } else {
                console.error("⚠️ Erreur lock realtime:", updateError.message);
            }
        })
        .subscribe((status, err) => {
            if (status === 'SUBSCRIBED') {
                console.log("📡 Abonnement Realtime actif.");
            } else if (status === 'CHANNEL_ERROR') {
                console.error("❌ ERREUR REALTIME (CHANNEL_ERROR) :", err);
            } else if (status === 'TIMED_OUT') {
                console.error("❌ ERREUR REALTIME (TIMED_OUT) :", err);
            } else {
                console.log(`ℹ️ Statut Realtime changé : ${status}`);
                if (err) console.error("Détail erreur :", err);
            }
        });
}

// --- Ticket Generators ---

function generateKitchenTicket(order, items, customerInfo) {
    const encoder = new EscPosEncoder();
    let ticket = encoder.initialize();

    // Header Cuisine (Gros)
    ticket
        .align('center')
        .size('2', '2')
        .line('BON CUISINE')
        .size('1', '1') // Reset size
        .line('--------------------------------')
        .align('left');

    ticket.line(`CMD: ${order.order_number || order.id}`);
    ticket.line(`Heure: ${new Date().toLocaleTimeString()}`);
    ticket.line('--------------------------------');

    // Body Cuisine (Items)
    if (Array.isArray(items) && items.length > 0) {
        items.forEach(item => {
            // Quantité en GRAS + Nom
            ticket.bold(true).text(`${item.quantity}x `).bold(false).line(item.name);

            // Options & Notes (Indented)
            if (item.options && item.options.length > 0) {
                item.options.forEach(opt => {
                    ticket.line(`   + ${opt}`);
                });
            }
            if (item.notes) { // Suppose 'notes' or 'comment' field exists
                ticket.invert(true).text(`   NOTE: ${item.notes} `).invert(false).newline();
            }
            ticket.newline();
        });
    } else {
        ticket.line("Aucun article.");
    }

    ticket
        .line('--------------------------------')
        .newline()
        .newline()
        .cut();

    return ticket.encode();
}

function generateCashierTicket(order, items, customerInfo) {
    const encoder = new EscPosEncoder();
    let ticket = encoder.initialize();

    // Header Caisse
    ticket
        .align('center')
        .line('MITAKE RAMEN')
        .line('TICKET CLIENT')
        .line('--------------------------------')
        .align('left');

    ticket.line(`CMD: ${order.order_number || order.id}`);
    ticket.line(`Date: ${new Date().toLocaleString()}`);
    ticket.line('--------------------------------');

    // Body Caisse (Items + Prix)
    if (Array.isArray(items) && items.length > 0) {
        items.forEach(item => {
            const price = item.price ? parseFloat(item.price).toFixed(2) : "0.00";
            ticket.line(`${item.quantity}x ${item.name}`);
            ticket.align('right').line(`${price} EUR`).align('left');

            if (item.options && item.options.length > 0) {
                item.options.forEach(opt => {
                    ticket.line(`   + ${opt}`);
                });
            }
        });
    }

    ticket.line('--------------------------------');

    // Footer Caisse
    const total = order.total_price ? parseFloat(order.total_price).toFixed(2) : "0.00";
    ticket
        .align('right')
        .bold(true).line(`TOTAL: ${total} EUR`).bold(false)
        .newline();

    ticket.align('left');
    // Payment Method (Simulation if not in order object)
    const paymentMethod = order.payment_method || "CB / Espèces";
    ticket.line(`Paiement: ${paymentMethod}`);

    // Customer Info
    if (customerInfo && (customerInfo.name || customerInfo.phone)) {
        ticket.line('--------------------------------');
        if (customerInfo.name) ticket.line(`Client: ${customerInfo.name}`);
        if (customerInfo.phone) ticket.line(`Tel: ${customerInfo.phone}`);
    }

    ticket
        .newline()
        .align('center')
        .line('Merci de votre visite !')
        .newline()
        .newline()
        .cut();

    return ticket.encode();
}

async function handleNewOrder(order, kitchenPrinter, cashierPrinter) {
    console.log(`🧾 Traitement de la commande : ${order.order_number || order.id}`);

    // --- Safe Parsing Logic ---
    let items = [];
    let customerInfo = {};

    try {
        // Parse Items
        if (typeof order.items === 'string') {
            try {
                items = JSON.parse(order.items);
                if (typeof items === 'string') items = JSON.parse(items);
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
                if (typeof customerInfo === 'string') customerInfo = JSON.parse(customerInfo);
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
        // 1. Impression CUISINE
        if (kitchenPrinter) {
            console.log(`👨‍🍳 Génération ticket CUISINE pour ${kitchenPrinter}...`);
            const kitchenData = generateKitchenTicket(order, items, customerInfo);
            const kitchenBase64 = Buffer.from(kitchenData).toString('base64');
            const kResult = await printRawPowershell(kitchenPrinter, kitchenBase64);
            if (kResult) console.log("✅ Ticket CUISINE envoyé.");
            else console.error("❌ Échec ticket CUISINE.");
        }

        // 2. Impression CAISSE
        if (cashierPrinter) {
            console.log(`💰 Génération ticket CAISSE pour ${cashierPrinter}...`);
            const cashierData = generateCashierTicket(order, items, customerInfo);
            const cashierBase64 = Buffer.from(cashierData).toString('base64');
            const cResult = await printRawPowershell(cashierPrinter, cashierBase64);
            if (cResult) console.log("✅ Ticket CAISSE envoyé.");
            else console.error("❌ Échec ticket CAISSE.");
        }

    } catch (err) {
        console.error("❌ Erreur traitement commande (Impression):", err);
    }
}

main();
