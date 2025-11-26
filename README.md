# Mitake Middleware (Standalone Windows)

This is a standalone middleware application for Mitake Ramen that connects Supabase Realtime to an EPSON TM-T20IV USB printer on Windows 10/11.

## Features
- **Diagnostic Mode**: Lists all available printers at startup.
- **Manual Configuration**: Force a specific printer via `.env`.
- **Zero Config**: Automatically detects the EPSON printer via USB if no manual config is present.
- **Realtime**: Prints tickets instantly when a new order is inserted into Supabase.
- **Standalone**: Single `.exe` file, no installation required.

## ⚠️ IMPORTANT: ADMINISTRATOR RIGHTS ⚠️
**You MUST run this application as Administrator.**
1. Right-click `mitake-middleware.exe`.
2. Select **"Run as administrator"**.

*Why?* This application needs direct access to the Windows Spooler (`winspool.drv`) and WMI to detect USB devices. If run as a normal user, it may fail to find the printer or send data.

## Setup Instructions

### 1. Download the Executable
1. Go to the **Actions** tab in this GitHub repository.
2. Click on the latest successful workflow run.
3. Scroll down to **Artifacts** and download `MitakePrinter-Windows`.
4. Extract the zip file to get `mitake-middleware.exe`.

### 2. Configuration
1. Create a new file named `.env` in the same folder as `mitake-middleware.exe`.
2. Add your Supabase credentials:
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your-anon-key
   ```

### 3. Run & Printer Selection
1. Ensure your printer is connected and powered on.
2. Double-click `mitake-middleware.exe`.
3. The console will display a list of **DETECTED PRINTERS**.

#### Option A: Auto-Detection
If you do nothing, the script will try to find a printer named "EPSON" on a "USB" port.

#### Option B: Manual Selection (Recommended if Auto fails)
If the auto-detection fails, copy the **exact name** of your printer from the list displayed in the console.
Add it to your `.env` file:

```env
TARGET_PRINTER_NAME="EPSON TM-T20IV Receipt"
```
*(Keep the quotes if there are spaces in the name)*

Restart the application. It will now say:
`🎯 Configuration manuelle détectée : "EPSON TM-T20IV Receipt"`

## Troubleshooting
- **Printer not found**: Check the console output for the list of printers. Use `TARGET_PRINTER_NAME` in `.env` to force the correct one.
- **Supabase Error**: Check your `.env` file for typos in the URL or Key.
