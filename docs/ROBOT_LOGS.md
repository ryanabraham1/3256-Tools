# Shared robot log library

`/logs` adds team-authenticated WPILOG browsing, upload, playback, four-channel plotting, field replay, and evidence-linked power/robot diagnostics. Local imports are analyzed in a browser worker. Logs can be opened through a shared `/logs?log=<sha256>` link after signing in with the existing team code.

## Production setup

1. Apply **only** `supabase/migrations/20261110223420_robot_log_library.sql` to the same Supabase project used by this deployment. It creates the RLS-enabled metadata table and private `robot-logs` storage bucket. Do not apply unrelated historic migrations to an existing database.
2. Keep the existing server-side Supabase URL/service-role configuration and team-session settings. The service key must stay server-side. No public bucket or anonymous table policy is needed.
3. Apply `supabase/migrations/20261111170000_robot_log_devices.sql` for per-device upload tokens. Signed-in teammates then open **Logs → Connect Mayhem**, name their laptop, and copy the token into Mayhem (**Robot → Team upload → Device upload token**). Tokens look like `mhm_…`, are shown once, and are stored only as a SHA-256 hash. Each device shows when it was last used and can be revoked immediately; logs it already uploaded stay. Device tokens permit uploading only. The older shared `ROBOT_LOG_UPLOAD_TOKEN` server variable still works if set, so existing installs keep uploading; remove it once every laptop has its own token.
4. Deploy this branch, then verify with a synthetic or approved WPILOG: upload from `/logs`, refresh the library, open its share link in another signed-in session, play/scrub, and confirm unsigned requests cannot browse/download it. Then test a Mayhem desktop upload and a retry after an interrupted confirmation.

Production is live at https://3256tools.vercel.app/logs. On 2026-11-10 the migration was applied to the existing team project, private storage/RLS were verified, and an upload-only device token was configured. A labeled synthetic recording was uploaded through both the API and installed Mayhem desktop; authenticated share-link download, hash verification, playback, findings, and actual hosted AdvantageScope graphs were checked. Upload tokens were verified unable to browse/download. Physical robot collection and real-match diagnostic accuracy remain unverified.

Each shared recording has **Open in AdvantageScope**, which opens actual upstream AdvantageScope Lite inside the team site with that recording. See [ADVANTAGESCOPE.md](ADVANTAGESCOPE.md) for the pinned upstream version, licensing, build process, integration and limitations.

## Upload path

`POST /api/robot-logs` accepts small metadata `{name,size,sha256}` after cookie or upload-token authorization and returns a signed private-storage upload URL. The client uploads the original binary directly with `Content-Type: application/octet-stream`; it does not pass through a Vercel function body. The client then posts `{complete:true,sha256}`. The server checks the stored size and makes the recording visible. A repeated start recovers an interrupted confirmation. Duplicate content is keyed by SHA-256.

The library API (`GET /api/robot-logs` and `/api/robot-logs/<hash>/file`) accepts the team cookie or a per-device `mhm_` token from Connect Mayhem, which Mayhem uses for its Team cloud list. The legacy shared `ROBOT_LOG_UPLOAD_TOKEN` stays upload-only. `/api/robot-logs/<hash>/file` returns a private signed download URL valid for 120 seconds. Library/file responses are not cacheable. Browser downloads verify the actual SHA-256 before parsing. The server uses the client's hash for naming/deduplication and validates size; it does not independently hash the entire remote object during confirmation. Device tokens should therefore be limited to trusted team laptops, and revoked when a laptop leaves the team.

Team admins can delete a recording from its page (`DELETE /api/robot-logs/<hash>`): it removes the stored file, then the library row. Device and upload tokens can never delete. There is no automatic retention cleanup of pending uploads yet. Monitor storage usage and failed pending rows. Signed URLs are bearer capabilities until they expire.

## Analysis and display

The parser supports WPILOG 1.0 scalar values, numeric/boolean arrays, and selected common WPILib structs, including Pose2d. Unknown types are listed. Current limits are 250 MB per file and two million decoded samples. Raw samples remain intact; graph decimation preserves bucket minima/maxima so short spikes are visible. Playback uses historical values at the cursor.

Power rules are initial diagnostic thresholds, not proven root causes or a breaker simulation. Missing signals are explicit. Loop/fault/disconnection/state-chatter rules require suitable recorded channels. Position mapping assumes blue-origin meters and heading radians; map channels explicitly when names differ. The quick replay uses a coordinate view; AdvantageScope provides its own season field assets.

Shared parser, plotting, and analysis sources are copied from Mayhem with `node scripts/sync-team-log-core.mjs /path/to/3256-Tools` in the Mayhem repository. Keep these sources aligned when changing either client.

## Validation

```sh
node --test tests/robot-logs.test.mjs
npx eslint components/robot-logs app/api/robot-logs lib/robot-logs 'app/(app)/logs'
npm run build
```

Route tests cover token scope, metadata bounds, signed upload/recovery, and stored-size mismatches. They use mocks and do not prove production storage is configured. Local browser file parsing and playback should also be tested with a generated recording and a real robot recording before release.
