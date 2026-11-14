<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Keep issue lists consistent everywhere

Issues are rendered in several places: the Tasks pages, a project's Tasks tab (`project-detail.tsx`), and the sub-issue / milestone / initiative issue lists in `detail.tsx`. They all share one row, `IssueRow` in `components/work/collections.tsx`. The Tasks pages and the project tab also share the whole browser (status tabs, search, filters, sort, grouping, list/board, bulk bar): `IssueBrowser` in `components/work/issue-browser.tsx`. When asked to change how issues behave or look (context menu, hover actions, labels, columns, etc.), change those shared pieces so every surface gets it; don't build a one-off list. The issue right-click menu lives in `components/work/issue-menu.tsx` (`useIssueMenu`); reuse it rather than building new menus.

# Work saves are instant; keep them that way

Edits made in place (status, priority, assignee, labels, archive, delete, drag on the board) go through `quick()` in `components/work/workspace.tsx`: the change shows immediately, saves in the background through the queue in `lib/work-store.ts`, and is undone with a toast if the server refuses it. Don't disable controls while a save is in flight, and don't add `revalidatePath` to `mutateWork` (it re-downloads the whole workspace on every edit; the saved rows are returned instead). Pages inside `/work` switch with `go()` (history.pushState), not `router.push`, so navigation never waits on the server.
