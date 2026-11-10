# Shared robot log library

`/logs` adds team-authenticated WPILOG browsing, upload, playback, four-channel plotting, field replay, and evidence-linked power/robot diagnostics. Local imports are analyzed in a browser worker. Logs can be opened through a shared `/logs?log=<sha256>` link after signing in with the existing team code.

## Production setup

1. Apply **only** `supabase/migrations/20261110223420_robot_log_library.sql` to the same Supabase project used by this deployment. It creates the RLS-enabled metadata table and private `robot-logs` storage bucket. Do not apply unrelated historic migrations to an existing database.
2. Keep the existing server-side Supabase URL/service-role configuration and team-session settings. The service key must stay server-side. No public bucket or anonymous table policy is needed.
3. For desktop automatic uploads, generate a random secret of at least 32 characters and configure `ROBOT_LOG_UPLOAD_TOKEN` on the server. Paste that token into Mayhem's Device upload token field. It permits uploading only; library browsing and signed downloads still require the normal team login. This is separate from the team login code.
4. Deploy this branch, then verify with a synthetic or approved WPILOG: upload from `/logs`, refresh the library, open its share link in another signed-in session, play/scrub, and confirm unsigned requests cannot browse/download it. Then test a Mayhem desktop upload and a retry after an interrupted confirmation.

The migration and production upload round trip have **not** been verified against the deployed database. The configured project must be checked before marking deployment complete.

## Upload path

`POST /api/robot-logs` accepts small metadata `{name,size,sha256}` after cookie or upload-token authorization and returns a signed private-storage upload URL. The client uploads the original binary directly with `Content-Type: application/octet-stream`; it does not pass through a Vercel function body. The client then posts `{complete:true,sha256}`. The server checks the stored size and makes the recording visible. A repeated start recovers an interrupted confirmation. Duplicate content is keyed by SHA-256.

The library API requires the existing team cookie. `/api/robot-logs/<hash>/file` returns a private signed download URL valid for 120 seconds. Library/file responses are not cacheable. Browser downloads verify the actual SHA-256 before parsing. The server uses the client's hash for naming/deduplication and validates size; it does not independently hash the entire remote object during confirmation. Upload tokens should therefore be limited to trusted team devices.

No delete API is included. There is no automatic retention cleanup of pending uploads yet. Monitor storage usage and failed pending rows. Signed URLs are bearer capabilities until they expire.

## Analysis and display

The parser supports WPILOG 1.0 scalar values, numeric/boolean arrays, and selected common WPILib structs, including Pose2d. Unknown types are listed. Current limits are 250 MB per file and two million decoded samples. Raw samples remain intact; graph decimation preserves bucket minima/maxima so short spikes are visible. Playback uses historical values at the cursor.

Power rules are initial diagnostic thresholds, not proven root causes or a breaker simulation. Missing signals are explicit. Loop/fault/disconnection/state-chatter rules require suitable recorded channels. Position mapping assumes blue-origin meters and heading radians; map channels explicitly when names differ. The field uses Mayhem's original vector drawing.

Shared parser, plotting, and analysis sources are copied from Mayhem with `node scripts/sync-team-log-core.mjs /path/to/3256-Tools` in the Mayhem repository. Keep these sources aligned when changing either client.

## Validation

```sh
node --test tests/robot-logs.test.mjs
npx eslint components/robot-logs app/api/robot-logs lib/robot-logs 'app/(app)/logs'
npm run build
```

Route tests cover token scope, metadata bounds, signed upload/recovery, and stored-size mismatches. They use mocks and do not prove production storage is configured. Local browser file parsing and playback should also be tested with a generated recording and a real robot recording before release.
