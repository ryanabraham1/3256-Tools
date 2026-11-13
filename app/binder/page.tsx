import type { Metadata } from "next";
import { ThemeToggle } from "@/components/theme-toggle";
import { BinderHero, BinderSubsystem, FeatureList } from "@/components/binder/binder";
import { CAD_GENERATED, FOREWORD, GAME_ANALYSIS, ROBOT, ROBOT_RENDER, SOFTWARE, SUBSYSTEMS, TOTALS, calloutLine } from "@/lib/binder";
import "./binder.css";

// Public: the binder is for judges and other teams, so it sits outside the sign-in wall.
export const metadata: Metadata = {
  title: `${ROBOT.name ? `${ROBOT.name} · ` : ""}${ROBOT.number} · ${ROBOT.season} Technical Binder`,
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
          <a href="#software">Software</a>
          <ThemeToggle />
        </nav>
      </header>

      <BinderHero
        subsystems={SUBSYSTEMS}
        render={ROBOT_RENDER}
        title={title}
        eyebrow={`FRC ${ROBOT.number} · ${ROBOT.team} · ${ROBOT.season} ${ROBOT.game}`}
        totals={TOTALS}
      />

      <section className="b-intro" id="foreword">
        <div>
          <p className="b-eyebrow">Foreword</p>
          {FOREWORD.map((p) => <p key={p} className="b-intro-text">{p}</p>)}
          <p className="b-intro-text">Team {ROBOT.number} is proud to present our {ROBOT.season} robot{ROBOT.name ? `: ${ROBOT.name}` : ""}.</p>
        </div>
        <div>
          <p className="b-eyebrow">Game analysis</p>
          <p className="b-intro-goal">{GAME_ANALYSIS.goal}</p>
          <p className="b-intro-text">{GAME_ANALYSIS.method}</p>
        </div>
      </section>

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
          <li>
            <a href="#software">
              <code>{String(SUBSYSTEMS.length + 1).padStart(2, "0")}</code>
              <strong>Software</strong>
              <span>Vision, pose estimation, autos, and teleop assists.</span>
              <small>{SOFTWARE.length} topics</small>
            </a>
          </li>
        </ol>
      </section>

      {SUBSYSTEMS.map((s) => <BinderSubsystem key={s.id} s={s} />)}

      <section className="bw" id="software">
        <div className="bw-head">
          <p className="b-eyebrow">Software · {String(SUBSYSTEMS.length + 1).padStart(2, "0")}</p>
          <h2>Software</h2>
        </div>
        <div className="bw-grid">
          {SOFTWARE.map((w) => (
            <article key={w.title}>
              <h3>{w.title}</h3>
              {w.lede && <p className="bw-lede">{w.lede}</p>}
              <FeatureList features={w.features} />
            </article>
          ))}
        </div>
      </section>

      <footer className="b-foot">
        <span>FRC {ROBOT.number} {ROBOT.team}</span>
        <span>Model and part data exported from Onshape · {CAD_GENERATED}</span>
      </footer>
    </div>
  );
}
