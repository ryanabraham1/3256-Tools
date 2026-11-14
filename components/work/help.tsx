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
        <p>New to Work? Three things to know.</p>
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
              Open <b>My work</b> in the sidebar to see what&apos;s assigned to you.
            </p>
          </div>
        </li>
        <li>
          <span aria-hidden>2</span>
          <div>
            <b>Keep the status current</b>
            <p>Open a task and tap In progress when you start, then Done when it&apos;s finished.</p>
          </div>
        </li>
        <li>
          <span aria-hidden>3</span>
          <div>
            <b>Add or ask</b>
            <p>
              Use <b>New task</b> (or press <kbd>C</kbd>) to add work, and comment on a task if you&apos;re stuck.{" "}
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
  ["Project", "A bigger piece of work made of many tasks, with a start and target date."],
  ["Initiative", "A season-long goal that groups several projects together."],
  ["Milestone", "A checkpoint inside a project, like “Drive base done”."],
  ["Status", "Where a task is: Backlog → Todo → In progress → In review → Done."],
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
