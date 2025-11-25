# Mitake Middleware (Standalone Windows)

This is a standalone middleware application for Mitake Ramen that connects Supabase Realtime to an EPSON TM-T20IV USB printer on Windows 10/11.

## Features
- **Zero Config**: Automatically detects the EPSON printer via USB.
- **Realtime**: Prints tickets instantly when a new order is inserted into Supabase.
- **Standalone**: Single `.exe` file, no installation required.

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

### 3. Run
1. Ensure your EPSON TM-T20IV printer is connected via USB and powered on.
2. Double-click `mitake-middleware.exe`.
3. A console window will open showing the status:
   - "Searching for EPSON USB Printer..."
   - "Printer Found: EPSON TM-T20IV..."
   - "Connected to Supabase..."

## Troubleshooting
- **Printer not found**: Ensure the printer is ON and connected via USB. The app looks for a printer with "EPSON" in the name and "USB" in the port name.
- **Supabase Error**: Check your `.env` file for typos in the URL or Key.
