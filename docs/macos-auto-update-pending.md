# macOS Desktop Auto-Update — Pending Work

Status as of 2026-06-12. **Windows auto-update is done and live.** macOS auto-update
is fully *wired in code* but **blocked on an Apple Developer ID certificate** that
does not yet exist on the build machine. No code changes are required to finish it —
only the certificate + GitHub secrets, then a re-run of the workflow.

---

## TL;DR — what's left

1. Confirm `usavsolutions@gmail.com` has a **paid** Apple Developer Program membership.
2. Create a **Developer ID Application** certificate (the machine currently has only an
   *Apple Development* cert, which Apple rejects for notarization).
3. Export it as `DeveloperID.p12` (with a password).
4. Set two GitHub secrets correctly: `CSC_LINK` (base64 of the `.p12`) and
   `CSC_KEY_PASSWORD`. **`CSC_LINK` is currently empty — that is the active blocker.**
5. Re-run the **Desktop Build** workflow. The macOS job will sign + notarize and append
   `*.dmg`, `*-arm64.zip`, and `latest-mac.yml` to the `v<version>` release.
6. Verify the macOS update feed is live and consistent.

---

## Why it's blocked

- **No `.p12` on the machine** → `base64 -i …DeveloperID.p12` returned 0 bytes → the
  `CSC_LINK` secret was set to an empty string → the macOS build dies with
  `⨯ …/USAV-Orders-Backend not a file` (electron-builder resolves an empty cert path to
  the repo root).
- **Wrong cert type present.** `security find-identity -p codesigning -v` shows only:
  `Apple Development: MICHAEL JAMES GARISEK (Z84P89A8RR)`. Apple Development certs are for
  on-device dev runs; **notarization requires a "Developer ID Application" cert.**
- macOS auto-update is non-negotiable about signing: Squirrel.Mac (what electron-updater
  uses on macOS) refuses to apply an update unless the running app is Developer ID signed
  and the update's signature validates.

---

## Step-by-step to finish

### 1. Verify paid membership
developer.apple.com → sign in as `usavsolutions@gmail.com`. If it shows an account
dashboard (not an "enroll now" page), you're enrolled. Developer ID certs **require the
paid $99/yr program** — a free account cannot create them.

### 2. Create the Developer ID Application certificate
Xcode → Settings (⌘,) → **Accounts** → select the Apple ID → **Manage Certificates…** →
**"+"** → **Developer ID Application**. (If that entry is greyed out, the account isn't in
the paid program — resolve that first.)

### 3. Export to `.p12`
Keychain Access → **login** keychain → find
`Developer ID Application: MICHAEL JAMES GARISEK (Z84P89A8RR)` → expand the ▸ to confirm a
private key is nested → select **both** items → right-click → **Export 2 items…** → save as
`~/Desktop/DeveloperID.p12` → set a password (this becomes `CSC_KEY_PASSWORD`).

### 4. Set the two remaining secrets (the robust way)
```bash
# sanity check FIRST — must print a large number (tens of thousands), not 0
base64 -i ~/Desktop/DeveloperID.p12 | tr -d '\n' | wc -c

# then set CSC_LINK from single-line base64 piped via stdin (no --body, no < <(...) )
base64 -i ~/Desktop/DeveloperID.p12 | tr -d '\n' | \
  gh secret set CSC_LINK --repo usavsolutionsinc/USAV-Orders-Backend

gh secret set CSC_KEY_PASSWORD --repo usavsolutionsinc/USAV-Orders-Backend \
  --body 'THE_P12_EXPORT_PASSWORD'
```

### 5. Re-run the build
```bash
gh workflow run desktop-build.yml --ref main
```

### 6. Verify the macOS feed
```bash
# should return version + a url ending in -arm64.zip with a sha512
curl -sL https://github.com/usavsolutionsinc/USAV-Orders-Backend/releases/latest/download/latest-mac.yml
# release should now include the dmg, the -arm64.zip, and latest-mac.yml
gh release view v<version> --repo usavsolutionsinc/USAV-Orders-Backend
```

---

## Secrets checklist (repo: usavsolutionsinc/USAV-Orders-Backend)

| Secret | Purpose | State |
|---|---|---|
| `CSC_LINK` | base64 of the Developer ID `.p12` | ❌ EMPTY — must re-set with a real cert |
| `CSC_KEY_PASSWORD` | the `.p12` export password | ⚠️ set, but must match the real cert |
| `APPLE_ID` | Apple ID for notarization | ✅ set (`usavsolutions@gmail.com`) |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific pw from appleid.apple.com | ✅ set |
| `APPLE_TEAM_ID` | 10-char team id (expect `Z84P89A8RR`) | ✅ set — confirm it matches the Developer ID cert's team |

---

## Already done (no further work needed)

- `electron-builder.yml`: macOS `hardenedRuntime`, `entitlements`/`entitlementsInherit`
  (`electron/entitlements.mac.plist`), `notarize: true`, and a **`zip` target** (Squirrel.Mac
  updates from a zip, not a dmg). Space-free `artifactName` so GitHub's space→dot asset
  rename can't 404 the update URL.
- `.github/workflows/desktop-build.yml`: macOS build passes signing/notarization env from
  secrets, uploads `*.dmg`/`*.zip`/`latest-mac.yml`, and the `publish-release` job appends
  them to the `v<version>` release. Builds run with `--publish never` (electron-builder's
  implicit CI publish 403s the build token).
- `electron/main.js`: auto-update lifecycle logged via `electron-log` →
  `~/Library/Logs/USAV Orders/main.log`.

## Known limitations

- **Intel-legacy macOS build** (`electron-builder.mac-intel-legacy.yml`, Electron 22): auto-update
  is intentionally disabled in `main.js` (`isLegacyElectron`). Those users stay manual-install.
- Only the **arm64** (Apple Silicon) build is part of the auto-update feed.

## How to test macOS print BEFORE signing is sorted

The "Silent printing is only available in the desktop app" banner appears because the
installed macOS shell predates the `printHtml` preload bridge (added 2026-05-17; the shipped
arm64 dmg is from 2026-03-18). A current shell fixes it. To test without the signed pipeline,
build an unsigned local dmg (note: electron-builder's node-module-collector can OOM on the
pnpm tree — build from a clean `npm ci` tree or bump `--max-old-space-size`):
```bash
CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder --mac dmg \
  -c.mac.notarize=false -c.mac.identity=null --publish never
```
Install it via right-click → Open (Gatekeeper bypass for an unsigned app).
