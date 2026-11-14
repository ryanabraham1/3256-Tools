"use client";
import { dateLabel, done, isBlocked, issueCode, type WorkEvent, type WorkFilter, type WorkItem } from "@/lib/work";
import { Avatar } from "./collections";
import { GettingStarted } from "./help";
import { Icon, StatusPill } from "./icons";
import { useItemMenuShow } from "./item-menu";
import { SeverityPill, sortProblems } from "./robot-issues";
import { BlockedBadge } from "./task-actions";
import { useWork } from "./work-provider";
import { WorkLink } from "./work-link";

const GLANCE = [
  { status: "In progress", label: "In progress", tone: "warn" },
  { status: "Todo", label: "To do", tone: "info" },
  { status: "blocked", label: "Blocked", tone: "bad" },
  { status: "Done", label: "Done", tone: "good" },
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
  onNavigate,
  onCreate,
  onHelp,
  onReport,
  readOnly,
}: {
  items: WorkItem[];
  live: WorkItem[];
  actor: string;
  name?: string;
  events: WorkEvent[];
  onOpen: (item: WorkItem) => void;
  onNavigate: (path: string, filter?: WorkFilter) => void;
  onCreate: () => void;
  onHelp: () => void;
  onReport: () => void;
  readOnly: boolean;
}) {
  const { problems, snapshot } = useWork();
  const menuFor = useItemMenuShow();
  const issues = live.filter((i) => i.kind === "issue");
  const mine = issues
    .filter((i) => i.data.assignee === actor && !done(i))
    .sort(
      (a, b) =>
        (a.data.priority || 5) - (b.data.priority || 5) ||
        (a.data.due || "9999").localeCompare(b.data.due || "9999"),
    );
  const byId = new Map(live.map((i) => [i.id, i]));
  const sooner = (a: WorkItem, b: WorkItem) =>
    (a.data.due || "9999").localeCompare(b.data.due || "9999") || (a.data.priority || 5) - (b.data.priority || 5);
  const robot = sortProblems(problems.filter((p) => p.status === "open"));
  const eventName = new Map((snapshot.pitEvents ?? []).map((e) => [e.id, e.name]));
  const taskFor = (id: string) => issues.find((i) => i.data.problem === id);
  const blocked = issues.filter(isBlocked).sort(sooner);
  const recent = [...events]
    .filter((e) => byId.has(e.item_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6);
  // An account without a member name falls back to its email; don't greet anyone by address.
  const first = name?.includes("@") ? undefined : name?.split(/\s+/)[0];

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
        <div className="work-home-main">
        <section className="work-home-card work-home-mine" aria-labelledby="work-home-mine">
          <div className="work-home-card-head">
            <h2 id="work-home-mine">Your tasks</h2>
            <span>{mine.length} open</span>
            <WorkLink href="/work/my-issues" onGo={() => onNavigate("my-issues")}>See all</WorkLink>
          </div>
          {mine.length ? (
            mine.slice(0, 8).map((i) => {
              const project = byId.get(i.data.project ?? "");
              return (
                <button key={i.id} className="work-home-row" onClick={() => onOpen(i)} onContextMenu={menuFor(i)}>
                  <StatusPill status={i.data.status} />
                  <span className="work-home-row-main">
                    <b>{i.title}</b>
                    <span>
                      {issueCode(i, items)}
                      {project ? ` · ${project.title}` : ""}
                    </span>
                  </span>
                  <BlockedBadge item={i} />
                  {i.data.priority === 1 && <span className="pill pill-bad">Urgent</span>}
                  <span className="work-home-due">{i.data.due ? `Due ${dateLabel(i.data.due)}` : ""}</span>
                </button>
              );
            })
          ) : (
            <p className="work-home-empty">
              Nothing assigned to you yet. Ask a lead what to work on.
            </p>
          )}
        </section>
        <section className="work-home-card work-home-robot" aria-labelledby="work-home-robot">
          <div className="work-home-card-head">
            <h2 id="work-home-robot">Robot issues</h2>
            <span>{robot.length} open</span>
            <WorkLink href="/work/robot" onGo={() => onNavigate("robot")}>See all</WorkLink>
          </div>
          {robot.length ? (
            robot.slice(0, 6).map((p) => {
              const task = taskFor(p.id);
              const owner = byId.get(task?.data.assignee ?? "");
              return (
                <button key={p.id} className="work-home-row" onClick={() => (task ? onOpen(task) : onNavigate("robot"))}>
                  <SeverityPill severity={p.severity} />
                  <span className="work-home-row-main">
                    <b>{p.title}</b>
                    <span>
                      {[p.area, p.event_id ? eventName.get(p.event_id) : "Shop", task ? `${owner?.title ?? "Nobody"} is fixing it` : "No task yet"]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <p className="work-home-empty">Nothing wrong with the robot right now.</p>
          )}
          {!readOnly && (
            <div className="work-home-card-foot">
              <button className="btn btn-ghost" onClick={onReport}>
                <Icon name="plus" size={15} /> Report an issue
              </button>
            </div>
          )}
        </section>
        </div>
        <div className="work-home-side">
          {blocked.length > 0 && (
            <section className="work-home-card work-home-blocked" aria-labelledby="work-home-blocked">
              <div className="work-home-card-head">
                <h2 id="work-home-blocked">Blocked</h2>
                <span>{blocked.length} need help</span>
              </div>
              <ul>
                {blocked.slice(0, 6).map((i) => (
                  <li key={i.id}>
                    <button onClick={() => onOpen(i)} onContextMenu={menuFor(i)}>
                      <b>{i.title}</b>
                      <span>{i.data.blocked}</span>
                      <small>{byId.get(i.data.assignee ?? "")?.title ?? "Unassigned"}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="work-home-card" aria-labelledby="work-home-glance">
            <div className="work-home-card-head">
              <h2 id="work-home-glance">Team at a glance</h2>
            </div>
            <div className="work-home-stats">
              {GLANCE.map((g) => (
                <WorkLink key={g.status} href={`/work/issues?status=${encodeURIComponent(g.status)}`} onGo={() => onNavigate("issues", { status: g.status })} className={`work-home-stat pill-${g.tone}`}>
                  <b>
                    {g.status === "blocked" ? blocked.length
                        : issues.filter((i) => (i.data.status ?? "").toLowerCase() === g.status.toLowerCase()).length}
                  </b>
                  <span>{g.label}</span>
                </WorkLink>
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
                        <button className="work-text-button" onClick={() => onOpen(item)} onContextMenu={menuFor(item)}>
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
