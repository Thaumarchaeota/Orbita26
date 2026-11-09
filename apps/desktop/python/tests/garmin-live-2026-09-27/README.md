# Garmin 2026 live read-only capture

This directory is a local test artifact for the 2026 Garmin activity capture requested on 2026-09-27.

- It uses the existing Orbita token directory passed with `--token-dir`.
- It never calls `login()` or `garmin_login`; authentication is token load/refresh only.
- It does not write to Orbita SQLite, Garmin account data, or the token directory.
- Raw responses and downloaded activity files are user data. Do not commit or share them.

Run from `apps/desktop/python/scripts` with the bundled environment:

```powershell
..\\..\\.venv\\Scripts\\python.exe ..\\tests\\garmin-live-2026-09-27\\capture_activities.py `
  --token-dir "$env:APPDATA\\com.orbita.app\\data\\garmin" `
  --from 2026-01-01 --to 2026-09-27 `
  --output-dir ..\\tests\\garmin-live-2026-09-27\\result
```

By default the result contains one representative activity per distinct Garmin `activityType.typeKey`, while `activity_index.json` retains the full 2026 index and the complete type list. Add `--all-activities` only when a full per-activity capture is explicitly needed. Each representative has a raw JSON bundle, optional original/TCX/GPX/KML/CSV downloads, and the field inventory describes observed JSON paths and value types.
