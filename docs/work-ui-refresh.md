# Work UI refresh — November 9, 2026

The Work app now uses grouped Personal/Workspace navigation, direct Inbox access,
clearer active navigation, an accessible shared More menu, a visible New issue
action, and a bordered search field. A shared visual layer in
`components/work/work-refresh.css` aligns typography, spacing, controls, cards,
issue rows, project sidebars, and detail pages while retaining the existing
light/dark theme tokens and phone layouts. The workspace can use wider screens.

The parallel bug audit fixed:

- Status filters missing imported capitalization variants or implicit Backlog.
- Custom workflow statuses missing from the shared filter picker.
- Duplicate revision-based field saves after debounce/Enter followed by blur.
- Open picker and context-menu options remaining editable during disabled state.
- ArrowUp from a picker search skipping its last option.
- Saved layout/group being ignored for directly opened or favorite saved views.
- Transient selection, filters, and dialogs surviving section/entity URL changes.

## Validation

Passed `npm run build`, `npm run lint`, `npx tsc --noEmit`, and
`node --test tests/work.test.mjs tests/linear-import.test.mjs` (15 tests).
`git diff --check` passed.

Native Chrome checks used a temporary isolated sample-data page: desktop issue
list, search/clear, sorting popover, list/board switching, issue composer opening
and cancellation, and a 390-pixel project overview. The sample route was removed
before the final production build. Authentication remained unchanged; no live
workspace writes were performed. Full authenticated mutation flows and a complete
mobile interaction pass were not verified. This is a local implementation, with
no deployment performed.
