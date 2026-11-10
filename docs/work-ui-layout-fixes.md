# Work UI layout fixes — November 10, 2026

The project Cards/Timeline switch inherited a 36px icon-button width. Both
labeled buttons now size to their content; icon-only list/board buttons remain
compact, with 44px minimum touch targets on phones.

The visual review also corrected:

- Heading actions and sidebar search labels wrapping inside narrow controls.
- Project cards overflowing panes narrower than their 320px grid minimum.
- Project and task detail columns squeezing their main content beside navigation.
  They now stack based on the available content pane, not only viewport width.
- Project details leaving an empty column when the properties sidebar is hidden.
- Project tabs overlapping the refreshed 56px top bar.
- Desktop project names inheriting body-sized text.
- Narrow-screen project previews squeezing the underlying project browser.
- Phone toolbar controls and task-status touch targets being too cramped.
- The 761–767px phone range retaining fixed-height desktop scrolling.
- Nested task codes taking flexible space from titles across task, milestone,
  and initiative details; phone rows now put codes beneath titles.
- Tablet task rows retaining a desktop row arrangement in a narrow content pane.

## Verification

A temporary local route rendered the actual Work components with synthetic data;
it was removed before the production build. No live workspace mutations were made.

- Reviewed Home, tasks, projects, initiatives, saved views, documents,
  notifications, updates, insights, archive, settings, and task/project/milestone/
  initiative details at 390px.
- Checked the main collections and detail pages at 320, 765, 800, and 1440px.
  Rechecked the tablet task-detail and task-row overflow found during this pass.
- Inspected light and dark themes, Cards/Timeline and List/Board switching,
  project tabs and preview opening/closing, the sort picker and Escape dismissal,
  and task composer opening/cancellation.
- Browser console contained no captured warnings or errors.
- Passed `npm run build` (including TypeScript), `npm run lint`, and all 21 tests
  in `tests/work.test.mjs`, `tests/linear-import.test.mjs`, and
  `tests/regressions.mjs`. `git diff --check` passed.

Authenticated saves, production deployment, and the separate battery/fabrication
apps were outside this Work layout verification.
