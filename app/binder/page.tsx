import type { Metadata } from "next";
import { ThemeToggle } from "@/components/theme-toggle";
import { BinderHero, BinderSubsystem } from "@/components/binder/binder";
import { CAD_GENERATED, ROBOT, ROBOT_RENDER, SUBSYSTEMS, TOTALS, calloutLine } from "@/lib/binder";
import "./binder.css";

// Public: the binder is for judges and other teams, so it sits outside the sign-in wall.
export const metadata: Metadata = {
  title: `${ROBOT.number} · ${ROBOT.season} Technical Binder`,
  description: `FRC ${ROBOT.number} ${ROBOT.team}: the ${ROBOT.season} robot, subsystem by subsystem, straight from CAD.`,
};

export default function BinderPage() {
  const title = ROBOT.name ?? String(ROBOT.season);
  return (
    <div className="binder">
      <header className="b-nav">
        <a href="#robot" className="b-brand">
          <b>WB</b>
          <span>{ROBOT.number}</span>
          <em>{ROBOT.season} Binder</em>
        </a>
        <nav>
          <a href="#contents">Contents</a>
          <a href={`#${SUBSYSTEMS[0]?.id}`}>Mechanical</a>
          <ThemeToggle />
        </nav>
      </header>

      <BinderHero
        subsystems={SUBSYSTEMS}
        render={ROBOT_RENDER}
        title={title}
        eyebrow={`FRC ${ROBOT.number} · ${ROBOT.team}`}
        totals={TOTALS}
      />

      <section className="b-contents" id="contents">
        <div className="b-contents-head">
          <p className="b-eyebrow">Index</p>
          <h2>Contents</h2>
        </div>
        <ol>
          {SUBSYSTEMS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>
                <code>{String(s.index).padStart(2, "0")}</code>
                <strong>{s.name}</strong>
                <span>{calloutLine(s)}</span>
                <small>{s.parts} parts</small>
              </a>
            </li>
          ))}
        </ol>
      </section>

      {SUBSYSTEMS.map((s) => <BinderSubsystem key={s.id} s={s} />)}

      <footer className="b-foot">
        <span>FRC {ROBOT.number} {ROBOT.team}</span>
        <span>Model and part data exported from Onshape · {CAD_GENERATED}</span>
      </footer>
    </div>
  );
}
