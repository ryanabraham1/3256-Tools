"use client";
import Link from "next/link";
import { dateLabel, done, issueCode, type WorkEvent, type WorkItem } from "@/lib/work";
import { Avatar } from "./collections";
import { GettingStarted } from "./help";
import { Icon, StatusPill } from "./icons";

const GLANCE = [
  { status: "In progress", label: "In progress", tone: "warn", match: ["in progress", "in review"] },
  { status: "Todo", label: "To do", tone: "info", match: ["todo"] },
  { status: "Done", label: "Done", tone: "good", match: ["done", "completed"] },
  { status: "Backlog", label: "Backlog (ideas)", tone: "muted", match: ["backlog", ""] },
] as const;

function describe(e: WorkEvent) {
  if (e.type === "comment") return "commented on";
  if (e.type === "update") return "posted an update on";
  if (e.type === "reaction") return "reacted on";
  if (e.type === "status") return `moved to ${e.body.replace(/^.*→\s*/, "")}:`;
  if (e.type === "created") return "created";
  if (e.type === "updated") return "updated";
  return `${e.type}`;
}

/** Work's landing page: what a new (or returning) member needs first. */
export function WorkHome({
  items,
  live,
  actor,
  name,
  events,
  onOpen,
  onCreate,
  onHelp,
  readOnly,
}: {
  items: WorkItem[];
  live: WorkItem[];
  actor: string;
  name?: string;
  events: WorkEvent[];
  onOpen: (item: WorkItem) => void;
  onCreate: () => void;
  onHelp: () => void;
  readOnly: boolean;
}) {
  const issues = live.filter((i) => i.kind === "issue");
  const mine = issues
    .filter((i) => i.data.assignee === actor && !done(i))
    .sort(
      (a, b) =>
        (a.data.priority || 5) - (b.data.priority || 5) ||
        (a.data.due || "9999").localeCompare(b.data.due || "9999"),
    );
  const byId = new Map(live.map((i) => [i.id, i]));
  const recent = [...events]
    .filter((e) => byId.has(e.item_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6);
  const first = name?.split(/\s+/)[0];

  return (
    <div className="work-home">
      <div className="work-page-heading">
        <div>
          <h1>{first ? `Welcome back, ${first}` : "Welcome to Work"}</h1>
          <p>Here&apos;s what&apos;s on your plate and what the team has been up to.</p>
        </div>
        <div className="work-heading-actions">
          <button className="btn btn-primary" disabled={readOnly} onClick={onCreate}>
            <Icon name="plus" size={16} /> New task
          </button>
        </div>
      </div>
      <GettingStarted onHelp={onHelp} />
      <div className="work-home-grid">
        <section className="work-home-card work-home-mine" aria-labelledby="work-home-mine">
          <div className="work-home-card-head">
            <h2 id="work-home-mine">Assigned to you</h2>
            <span>{mine.length} open</span>
            <Link href="/work/my-issues">See all</Link>
          </div>
          {mine.length ? (
            mine.slice(0, 8).map((i) => {
              const project = byId.get(i.data.project ?? "");
              return (
                <button key={i.id} className="work-home-row" onClick={() => onOpen(i)}>
                  <StatusPill status={i.data.status} />
                  <span className="work-home-row-main">
                    <b>{i.title}</b>
                    <span>
                      {issueCode(i, items)}
                      {project ? ` · ${project.title}` : ""}
                    </span>
                  </span>
                  {i.data.priority === 1 && <span className="pill pill-bad">Urgent</span>}
                  <span className="work-home-due">{i.data.due ? `Due ${dateLabel(i.data.due)}` : ""}</span>
                </button>
              );
            })
          ) : (
            <p className="work-home-empty">
              Nothing assigned to you yet. Pick something from <Link href="/work/issues?status=Todo">To do</Link>, or ask
              a lead what to work on.
            </p>
          )}
        </section>
        <div className="work-home-side">
          <section className="work-home-card" aria-labelledby="work-home-glance">
            <div className="work-home-card-head">
              <h2 id="work-home-glance">Team at a glance</h2>
            </div>
            <div className="work-home-stats">
              {GLANCE.map((g) => (
                <Link key={g.status} href={`/work/issues?status=${encodeURIComponent(g.status)}`} className={`work-home-stat pill-${g.tone}`}>
                  <b>
                    {
                      issues.filter((i) =>
                        (g.match as readonly string[]).includes((i.data.status ?? "").toLowerCase()),
                      ).length
                    }
                  </b>
                  <span>{g.label}</span>
                </Link>
              ))}
            </div>
          </section>
          <section className="work-home-card" aria-labelledby="work-home-recent">
            <div className="work-home-card-head">
              <h2 id="work-home-recent">Latest activity</h2>
            </div>
            {recent.length ? (
              <ul className="work-home-activity">
                {recent.map((e) => {
                  const item = byId.get(e.item_id)!;
                  return (
                    <li key={e.id}>
                      <Avatar small name={e.actor} />
                      <p>
                        <b>{e.actor}</b>{" "}
                        <span className="work-home-activity-body">{describe(e)}</span>{" "}
                        <button className="work-text-button" onClick={() => onOpen(item)}>
                          {item.title}
                        </button>
                        <small>{dateLabel(e.created_at)}</small>
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="work-home-empty">No activity yet.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
