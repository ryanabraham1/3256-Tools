@AGENTS.md

# Robot logs must stay in sync with Mayhem

The Logs page here and the Logs page in the Mayhem desktop app (github.com/ryanabraham1/Mayhem) are meant to behave identically: same analysis, same current-draw filtering, same signal-mapping editor, same "estimated" labels.

- `lib/robot-logs/core/{analysis,wpilog,plot}.ts` are generated copies. Never edit them here. Change `app/src/suite/core/` in Mayhem and run `node scripts/sync-team-log-core.mjs <path to this repo>` from Mayhem.
- The UI is NOT shared code. If you change the signal-mapping editor, current-draw list, estimated-current labels, or saved-mapping behavior in `components/robot-logs/viewer.tsx`, make the same change in Mayhem's `app/src/suite/logs/LogsPage.tsx` and `app/src/suite/logLibrary.tsx` (and the reverse). Saved mappings use the localStorage key `robot-log-mapping:<log id>` in both.
- Add or update tests in both repos when behavior changes.
