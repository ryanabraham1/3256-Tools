import cad from "./binder-cad.json";

/**
 * Tech binder content. Numbers come from the CAD (lib/binder-cad.json, rebuilt by
 * scripts/binder-cad.mjs); everything written by people lives here. Leave a field
 * empty and the page falls back to what the CAD can say on its own.
 */

export interface Feature {
  text: string;
  sub?: string[];
}

interface Writeup {
  /** Top-level assembly instance name in the robot CAD. */
  node: string;
  name: string;
  /** Where the hero callout's leader line lands on robot.webp, in percent (x, y). */
  anchor: [number, number];
  /** One line under the hero callout and the section title. */
  tagline?: string;
  features?: Feature[];
}

export const ROBOT = {
  team: "WarriorBorgs",
  number: 3256,
  season: 2026,
  /** Robot name for the hero. Null shows the season instead. */
  name: null as string | null,
};

// Binder order: how a judge would walk the robot, ground up.
const WRITEUPS: Writeup[] = [
  { node: "Drivebase Assembly <1>", name: "Drivebase", anchor: [89, 66] },
  { node: "0550_Ground_Intake_Assembly <1>", name: "Intake", anchor: [26.5, 86] },
  { node: "Assembly 3 <1>", name: "Hopper", anchor: [11.5, 38] },
  { node: "Assembly 1 <1>", name: "Spindexer", anchor: [47, 61] },
  { node: "0200_Turret_Assembly <1>", name: "Turret", anchor: [79.5, 38] },
  { node: "0900_V2_Shooter_Assembly <1>", name: "Shooter", anchor: [69, 26] },
];

export interface Render {
  src: string;
  w: number;
  h: number;
}

export type View = "iso" | "front" | "side" | "top";

export interface Subsystem extends Writeup {
  id: string;
  index: number;
  document: string;
  parts: number;
  uniqueParts: number;
  motors: Record<string, number>;
  customParts: string[];
  hardware: { name: string; qty: number }[];
  views: Partial<Record<View, Render>>;
}

export const SUBSYSTEMS: Subsystem[] = WRITEUPS.flatMap((w, i) => {
  const c = cad.subsystems.find((s) => s.node === w.node);
  if (!c) return [];
  return [{ ...c, ...w, motors: c.motors as Record<string, number>, views: c.views as Subsystem["views"], id: w.name.toLowerCase().replace(/\W+/g, "-"), index: i + 1 }];
});

export const CAD_GENERATED = cad.generated;
export const ROBOT_RENDER: Render = cad.robot;

export const motorCount = (s: Pick<Subsystem, "motors">) => Object.values(s.motors).reduce((a, b) => a + b, 0);

export const motorLine = (s: Pick<Subsystem, "motors">) =>
  Object.entries(s.motors)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${n}× ${m}`)
    .join(", ");

/** What the hero callout says when nobody has written a tagline yet. */
export const calloutLine = (s: Subsystem) => s.tagline ?? (motorCount(s) ? `${motorLine(s)}.` : `${s.parts} parts, no motors.`);

/** Feature list: the team's write-up, or the facts the CAD can give. */
export function featuresOf(s: Subsystem): Feature[] {
  if (s.features?.length) return s.features;
  const out: Feature[] = [];
  if (motorCount(s)) out.push({ text: `${motorCount(s)} motors`, sub: Object.entries(s.motors).map(([m, n]) => `${n}× ${m}`) });
  if (s.customParts.length) out.push({ text: `${s.customParts.length} team-designed parts`, sub: s.customParts.slice(0, 8) });
  if (s.hardware.length) out.push({ text: "Key hardware", sub: s.hardware.slice(0, 6).map((h) => (h.qty > 1 ? `${h.qty}× ${h.name}` : h.name)) });
  return out;
}

export const TOTALS = {
  parts: SUBSYSTEMS.reduce((a, s) => a + s.parts, 0),
  motors: SUBSYSTEMS.reduce((a, s) => a + motorCount(s), 0),
  custom: SUBSYSTEMS.reduce((a, s) => a + s.customParts.length, 0),
};
