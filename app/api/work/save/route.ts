import { mutateWork } from "@/app/work-actions";
const headers = { "Cache-Control": "private, no-store" };
/**
 * Saves Work edits. A plain request rather than a server action, so a save in flight never
 * queues behind (or holds up) moving between pages. mutateWork checks the signed-in account itself.
 */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ ok: false, error: "Invalid origin." }, { status: 403, headers });
  let changes: unknown;
  try {
    changes = (await request.json())?.changes;
  } catch {
    return Response.json({ ok: false, error: "Invalid change." }, { status: 400, headers });
  }
  return Response.json(await mutateWork(changes as Parameters<typeof mutateWork>[0]), { headers });
}
