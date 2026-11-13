"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { deletePitProblem, setPitProblemStatus } from "@/app/pit-actions";
import {
  PHASE_LABEL,
  PROBLEM_STATUS_LABEL,
  PROBLEM_STATUS_TONE,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  type PitEvent,
  type PitItem,
  type PitProblem,
} from "@/lib/pit";
import { fmtDateTime } from "@/lib/format";
import { ConfirmButton } from "./confirm-button";
import { ErrorText, useFabAction } from "./fab-ui";
import { ProblemForm } from "./pit-ui";
import { Sheet } from "./sheet";
import { Empty } from "./ui";

type Show = "open" | "all" | "gaps";

export function PitProblems({
  problems,
  items,
  events,
  eventId,
  canWrite,
}: {
  problems: PitProblem[];
  items: PitItem[];
  events: PitEvent[];
  /** "" = every competition */
  eventId: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const openId = sp.get("id");
  const itemFilter = sp.get("item");
  const [show, setShow] = useState<Show>(itemFilter ? "all" : "open");
  const [area, setArea] = useState("");
  const [adding, setAdding] = useState(false);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const eventName = useMemo(() => new Map(events.map((e) => [e.id, e.name])), [events]);
  const areas = [...new Set(problems.map((p) => p.area).filter(Boolean))].sort();
  const editing = openId ? problems.find((p) => p.id === openId) : undefined;
  const setStatus = useFabAction(setPitProblemStatus);

  const shown = problems.filter(
    (p) =>
      (show === "all" || (show === "open" ? p.status === "open" : !p.item_id)) &&
      (!area || (p.area || "Unsorted") === area) &&
      (!itemFilter || p.item_id === itemFilter),
  );

  function go(params: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(params)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const q = next.toString();
    router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 flex-wrap items-center">
        {(
          [
            ["open", `Open (${problems.filter((p) => p.status === "open").length})`],
            ["all", `All (${problems.length})`],
            ["gaps", `Not on checklist (${problems.filter((p) => !p.item_id).length})`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" className="tile tile-chip" data-selected={show === k} onClick={() => setShow(k)}>
            {label}
          </button>
        ))}
        <select className="input w-auto" style={{ minHeight: 38, paddingTop: 4, paddingBottom: 4 }} value={eventId} onChange={(e) => go({ event: e.target.value || "all" })} aria-label="Competition">
          <option value="">Every competition</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {e.active ? " (now)" : ""}
            </option>
          ))}
        </select>
        {areas.length > 0 && (
          <select className="input w-auto" style={{ minHeight: 38, paddingTop: 4, paddingBottom: 4 }} value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
            <option value="">Every area</option>
            {[...areas, "Unsorted"].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        )}
        {itemFilter && (
          <button type="button" className="chip" onClick={() => go({ item: null })}>
            Check: {itemById.get(itemFilter)?.title ?? "?"} ✕
          </button>
        )}
        {canWrite && (
          <button type="button" className="btn btn-primary text-sm min-h-10 py-1.5 sm:ml-auto" onClick={() => setAdding(true)}>
            + Log problem
          </button>
        )}
      </div>
      <ErrorText error={setStatus.error} />

      {shown.length === 0 ? (
        <Empty>{show === "open" ? "No open problems." : "No problems logged here."}</Empty>
      ) : (
        <ul className="card overflow-hidden">
          {shown.map((p) => {
            const item = p.item_id ? itemById.get(p.item_id) : undefined;
            return (
              <li key={p.id} className="px-4 py-3 border-t first:border-t-0 flex gap-3 items-start" style={{ borderColor: "var(--line)" }}>
                <div className="min-w-0 flex-1">
                  <div className="flex gap-1.5 flex-wrap items-center">
                    <span className={`pill pill-${SEVERITY_TONE[p.severity]}`}>{SEVERITY_LABEL[p.severity]}</span>
                    <span className={`pill pill-${PROBLEM_STATUS_TONE[p.status]}`}>{PROBLEM_STATUS_LABEL[p.status]}</span>
                    {p.area && <span className="chip">{p.area}</span>}
                    {p.match_label && <span className="chip mono">{p.match_label}</span>}
                  </div>
                  <button type="button" className="block text-left font-semibold mt-1.5 hover:underline break-words" onClick={() => go({ id: p.id })}>
                    {p.title}
                  </button>
                  {p.details && (
                    <p className="text-sm mt-0.5 whitespace-pre-wrap" style={{ color: "var(--muted)" }}>
                      {p.details}
                    </p>
                  )}
                  {p.fix && (
                    <p className="text-sm mt-1">
                      <b>Fix:</b> {p.fix}
                    </p>
                  )}
                  {p.follow_up && (
                    <p className="text-sm mt-0.5">
                      <b>Follow-up:</b> {p.follow_up}
                    </p>
                  )}
                  <p className="mono text-[11px] mt-1.5" style={{ color: "var(--muted)" }}>
                    {item ? `${PHASE_LABEL[item.phase]} check: ${item.title}` : "Not on the checklist"} · {p.event_id ? (eventName.get(p.event_id) ?? "?") : "Practice"} ·{" "}
                    {fmtDateTime(p.occurred_at)}
                    {p.reported_by ? ` · ${p.reported_by}` : ""}
                  </p>
                </div>
                {canWrite && p.status === "open" && (
                  <button type="button" className="btn btn-ghost text-sm min-h-10 py-1.5 shrink-0" disabled={setStatus.pending} onClick={() => setStatus.call({ id: p.id, status: "fixed" })}>
                    Fixed
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Log a problem">
        {adding && <ProblemForm items={items} areas={areas} onDone={() => setAdding(false)} />}
      </Sheet>
      <Sheet open={!!editing} onClose={() => go({ id: null })} title="Problem" eyebrow={editing?.reported_by ? `Logged by ${editing.reported_by}` : undefined}>
        {editing &&
          (canWrite ? (
            <>
              <ProblemForm key={editing.id} problem={editing} items={items} areas={areas} onDone={() => go({ id: null })} />
              <DeleteProblem id={editing.id} onDone={() => go({ id: null })} />
            </>
          ) : (
            <p className="text-sm whitespace-pre-wrap">{editing.details || editing.title}</p>
          ))}
      </Sheet>
    </div>
  );
}

function DeleteProblem({ id, onDone }: { id: string; onDone: () => void }) {
  const del = useFabAction(deletePitProblem, onDone);
  return (
    <div className="mt-4">
      <ConfirmButton label="Delete problem" message="It's removed from the log and the review." onConfirm={() => del.call({ id })} pending={del.pending} danger link />
      <ErrorText error={del.error} />
    </div>
  );
}
