# Silent printing — unbox receiving label (CTP800BD)

How the **Print** button on the unbox receiving page
(`LineEditPanel` → "Print · receive" / "Print only") reaches the **CTP800BD**
with no print dialog.

## How the print path resolves

`runPrintLabel()` → `printReceivingLabel()` tries, in order:

1. **Electron silent print** (`printHtmlSilent` → `webContents.print({ silent:true })`).
   Desktop shell only. Targets the printer chosen in Settings → Hardware. No
   dialog, no default-printer requirement. Returns `false` in a browser tab.
2. **WebUSB / Web Serial raw** (`getProfileForRole('label')` →
   `printRawToProfile`). Sends raw TSPL/ZPL/ESC-POS. **Only works for a
   driverless / WinUSB device.** Skipped for any `os`-kind profile.
3. **Hidden-iframe `window.print()`** (`printHtmlInIframe`). The label is mounted
   in an off-screen iframe whose embedded script calls `window.print()`. This is
   the path used for a browser tab printing to a Windows-installed printer.

## Browser tab + CTP800BD installed as a Windows printer (this workstation)

Because the CTP800BD is installed with a Windows **driver**, Windows' print stack
owns the USB interface, so WebUSB cannot claim it (path 2 is unavailable). The
label therefore prints via path 3 — the page's own `window.print()`.

A sandboxed browser cannot bypass the print dialog for a driver-owned printer on
its own. To make path 3 **silent**, the workstation must be configured once:

### 1. Make the CTP800BD the default printer, sized for the label

On this workstation the printer is installed twice:

| Spooler name           | Port    | Notes                                  |
| ---------------------- | ------- | -------------------------------------- |
| `CTP800BD`             | USB001  | USB, driver-owned — use this as default |
| `CTP800BD (Bluetooth)` | COM5:   | serial port — see the Web Serial option |

- The USB `CTP800BD` has been set as the Windows **default** (registry
  `Device = CTP800BD,CTP800BD,USB001`, and `LegacyDefaultPrinterMode=1` so
  Windows won't auto-reassign it). Re-set it from **Settings → Bluetooth &
  devices → Printers & scanners** if it ever changes.
- Open its **Printing preferences** and set the stock to the label size
  (the receiving label is **2 in × 1 in**; the `@page` in the HTML matches).
  Set margins to none / 0.

### 2. Launch Chrome or Edge with `--kiosk-printing`

`--kiosk-printing` makes every `window.print()` print immediately to the default
printer with **no dialog**. Create a desktop shortcut:

**Chrome**
```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=https://usav-orders-backend.vercel.app
```

**Edge**
```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk-printing --app=https://usav-orders-backend.vercel.app
```

(`--app=` is optional — it opens the site chrome-less. Drop it for a normal
window. The load-bearing flag is `--kiosk-printing`.)

Launch the receiving workstation's browser from this shortcut and the unbox
**Print** button prints the label straight to the CTP800BD, no dialog.

> Without `--kiosk-printing` the label still prints, but Windows shows the print
> dialog every time — that is browser security, not an app bug.

## Alternative: Web Serial raw to `CTP800BD (Bluetooth)` on COM5

Because the Bluetooth pairing exposes the printer as a **serial port (COM5)**,
the browser can drive it with raw ESC/POS — **silent, with no `--kiosk-printing`
flag and no default-printer requirement** (path 2 above, via Web Serial which is
not blocked by the USB print driver):

1. Settings → Hardware → **Pair serial printer** → pick COM5.
2. On the profile set **Role = Labels**, **Language = ESC/POS**, the right baud,
   and **Make default for label**.
3. Use the profile's **Test** button to confirm a label prints.

This needs the Bluetooth link to be connected. The USB + kiosk path is the more
reliable everyday setup; COM5/Web Serial is the dialog-free fallback if you'd
rather not launch the browser with a flag.

## Zero-config alternative: the desktop app

The Electron desktop shell (USAV Orders installer) needs none of the above. It
prints silently via `webContents.print` to whichever printer is selected in
**Settings → Hardware → Printer**, and can target the CTP800BD by name without it
being the OS default and without any browser flag. If silent printing matters on
a station, the desktop app is the most robust option.

## Verifying

- Mechanism (no auth, deterministic):
  `npx playwright test --config=playwright.silentprint.config.ts --headed`
  — asserts the hidden-iframe label runs its inline script under the app's real
  CSP and calls `window.print()` exactly once.
- Full wiring (needs a dev session + a resolvable test carton):
  `npx playwright test receiving-silent-print -g "clicking Print" --project=desktop`
  — drives the real unbox Print button and asserts it fires a label print.
