"use client";
import { useSyncExternalStore } from "react";

const TIPS_KEY = "work-tips-dismissed";
const tipsListeners = new Set<() => void>();
function tipsSubscribe(listener: () => void) {
  tipsListeners.add(listener);
  return () => void tipsListeners.delete(listener);
}
function tipsDismissed() {
  try {
    return localStorage.getItem(TIPS_KEY) === "1";
  } catch {
    return false;
  }
}
function dismissTips() {
  try {
    localStorage.setItem(TIPS_KEY, "1");
  } catch {
    /* Private mode: the card just comes back next visit. */
  }
  tipsListeners.forEach((l) => l());
}

/** A short, dismissible "Start here" card for people new to the workspace. */
export function GettingStarted({ onHelp }: { onHelp: () => void }) {
  const hidden = useSyncExternalStore(tipsSubscribe, tipsDismissed, () => true);
  if (hidden) return null;
  return (
    <section className="work-tips" aria-labelledby="work-tips-title">
      <div className="work-tips-head">
        <h2 id="work-tips-title">Start here</h2>
        <p>New to Work? Here&apos;s how a build session goes.</p>
        <button className="work-text-button" onClick={dismissTips}>
          Got it, hide this
        </button>
      </div>
      <ol className="work-tips-steps">
        <li>
          <span aria-hidden>1</span>
          <div>
            <b>Find your tasks</b>
            <p>
              What you&apos;re assigned is at the top of this page. Nothing there? Ask a lead what to work on.
            </p>
          </div>
        </li>
        <li>
          <span aria-hidden>2</span>
          <div>
            <b>Say where it&apos;s at</b>
            <p>Open the task and tap <b>Done</b> when it&apos;s finished. Waiting on parts or need help? Tap <b>I&apos;m stuck</b> so a lead sees it.</p>
          </div>
        </li>
        <li>
          <span aria-hidden>3</span>
          <div>
            <b>Report what you find</b>
            <p>
              Something wrong with the robot? Use <b>Report an issue</b> under <b>Robot issues</b>. Questions go in a task&apos;s comments.{" "}
              <button className="work-text-button" onClick={onHelp}>
                Full guide
              </button>
            </p>
          </div>
        </li>
      </ol>
    </section>
  );
}

const TERMS: [string, string][] = [
  ["Task", "One piece of work, like “Replace the intake belt”."],
  ["Robot issue", "Something wrong with the robot, reported from the shop or the pit. A lead turns it into a task to fix it."],
  ["Blocked", "A task that can't move until something else happens, like parts arriving. Say why so a lead can help."],
  ["Project", "A bigger piece of work made of many tasks, with a start and target date."],
  ["Initiative", "A bigger goal, like an event or training program, that groups several projects."],
  ["Milestone", "A checkpoint inside a project, like “Drive base done”."],
  ["Status", "Where a task is: Backlog (ideas) → To do (ready) → In progress → In review → Done."],
  ["Labels", "Tags for the subsystem or area a task belongs to, like Intake or Software."],
  ["View", "A saved set of filters you can come back to with one click."],
];
const KEYS: [string, string][] = [
  ["C", "Create a task"],
  ["/", "Jump to the search box"],
  ["⌘ / Ctrl + K", "Search everything and jump anywhere"],
  ["?", "Open this guide"],
  ["Esc", "Close any open window"],
];

export function HelpGuide() {
  return (
    <div className="work-help">
      <section>
        <h3>What things mean</h3>
        <dl>
          {TERMS.map(([term, text]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h3>Shortcuts</h3>
        <dl>
          {KEYS.map(([key, text]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h3>Handy tricks</h3>
        <ul>
          <li>Click the status circle, priority, or avatar on any row to change it without opening the task.</li>
          <li>Tick a few tasks to change their status, assign them, or archive them all at once.</li>
          <li>Deleted or archived something by mistake? Press Undo in the message that pops up.</li>
          <li>On a phone, tap the menu button in the top left to switch pages.</li>
        </ul>
      </section>
    </div>
  );
}
