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
  name: "Aimbot" as string | null,
  game: "REBUILT",
};

export const FOREWORD = [
  "This binder covers the game analysis, decisions, and designs that took us to our robot for the 2026 FIRST Robotics Competition season, REBUILT.",
  "Game analysis set our strategy and the robot requirements behind it. From those we prototyped, designed, and built each subsystem, and software ties them together.",
];

/** Game analysis: what we set out to do and how we decided what the robot does. */
export const GAME_ANALYSIS = {
  goal: "Win district events and qualify for the playoffs at the FIRST World Championship.",
  method:
    "At Kickoff we listed every action REBUILT allows and sorted them into a priority list, so the robot stays competitive and efficient while remaining as simple as possible.",
};

// Binder order: how a judge would walk the robot, ground up.
const WRITEUPS: Writeup[] = [
  {
    node: "Drivebase Assembly <1>",
    name: "Drivebase",
    anchor: [89, 66],
    tagline: "27\" × 27\" MK5n swerve, square for capacity and geared for the bump.",
    features: [
      { text: "27\" × 27\" MK5n swerve drivebase", sub: ["Maximizes ball capacity while staying square"] },
      { text: "L2 gearing to drive over the bump more easily" },
      { text: "Minimal screws on the bottom of the bellypan" },
      { text: "Electrical", sub: ["PDP 2.0 gives access to 24 motor ports", "Separate CAN chain for the drivebase so it keeps driving if something fails elsewhere"] },
    ],
  },
  {
    node: "0550_Ground_Intake_Assembly <1>",
    name: "Intake",
    anchor: [26.5, 86],
    tagline: "Gear-driven slapdown with three cat-tongue rollers and a kicker.",
    features: [
      {
        text: "Structure",
        sub: [
          "¼\" WCP SRPP (self-reinforced polypropylene) on ¼\" aluminum pivoting plates, kept separate for easy access and repair",
          "¼\" aluminum static plates mount to the drivebase and swerve mounting blocks, reinforced with nutstrips to standoffs on the swerve plates",
          "⅛\" polycarbonate side plates keep the hopper from “jumping over” the intake plates",
        ],
      },
      { text: "Pivot", sub: ["Kraken X44 on a 15:1 MAXPlanetary, geared 16:58T on the pivot plate", "Gear-driven slapdown lets the pivot jackshaft rest at the front of the robot", "~122° range of motion"] },
      {
        text: "Rollers",
        sub: [
          "Three 2\" rollers: cat tongue tape on polycarbonate tube dead axles, on WCP stub shafts to save weight",
          "Belted to 2 Kraken X60s at 3:1 for extra torque",
          "1\" kicker roller belted to the middle roller gearbox at 36:36T",
          "¼\" polycarbonate ramp, tensioned with zip-ties to standoffs, controls the ball as it enters",
        ],
      },
      { text: "Pulleys", sub: ["Custom TPU pulleys flex when the intake takes hits", "Built around the WCP 2¾\" stub shaft, screwed into heat-set inserts in the tube", "Six ⅛\" dowel (shear) pins keep the pulley from separating"] },
    ],
  },
  {
    node: "Assembly 3 <1>",
    name: "Hopper",
    anchor: [11.5, 38],
    tagline: "Extendable polycarbonate hopper that the intake pushes out.",
    features: [
      {
        text: "Structure",
        sub: [
          "⅛\" polycarbonate side walls",
          "Slides out on ⅜\" round shafts when the intake deploys",
          "Support plate on the intake prevents twisting",
          "Shafts along the top of the hopper and above the intake stop leaks and add stiffness",
        ],
      },
      { text: "Corrugated polycarbonate front panel", sub: ["Vertical corrugation deflects less sideways than flat polycarbonate", "Much lighter than solid polycarbonate, and keeps balls from leaking"] },
    ],
  },
  {
    node: "Assembly 1 <1>",
    name: "Spindexer & Feeder",
    anchor: [47, 61],
    tagline: "Funnels a full hopper into one line and lifts it into the turret.",
    features: [
      {
        text: "Spindexer",
        sub: [
          "⅛\" polycarbonate with angled ramps covering dead zones",
          "3D-printed cone with an aluminum insert",
          "Running the cone fast at our 2nd event destroyed parts, so we designed a custom adapter plate that has held up since",
          "Kraken X60 via a 16:48 belt",
        ],
      },
      {
        text: "Feeder",
        sub: [
          "¼\" aluminum plate with a PETG 3D-printed ramp",
          "3\" pickup wheels on a Kraken X60 via a 20:64 belt",
          "Custom PA6-CF printed hubs for the belted lift",
          "Front rollers belted 48:32, back rollers 32:32",
          "CANrange detects balls mid-feeder",
        ],
      },
    ],
  },
  {
    node: "0200_Turret_Assembly <1>",
    name: "Turret",
    anchor: [79.5, 38],
    tagline: "Knows where it's pointing at startup, from two encoders and the Chinese Remainder Theorem.",
    features: [
      {
        text: "Sensing",
        sub: [
          "2 WCP encoders on 3D-printed herringbone gears",
          "The gears are coprime, so the difference between their positions gives the turret's absolute position on startup",
        ],
      },
      {
        text: "Cable management",
        sub: [
          "¾\" expandable sheathing, clamped with strain relief at the turret corner, runs through the turret plate",
          "Thin polycarbonate over the turret plate gives the sheathing a smooth path",
          "Constant force spring tensions the cable; polycarbonate keeps its path clear so it can't jam",
        ],
      },
    ],
  },
  {
    node: "0900_V2_Shooter_Assembly <1>",
    name: "Shooter",
    anchor: [69, 26],
    tagline: "Pivoting shooter built to score from anywhere, aiming for ~7 balls a second.",
    features: [
      { text: "Structure", sub: ["¼\" and ⅛\" pocketed aluminum plates"] },
      { text: "Pivot", sub: ["27° range", "3D-printed herringbone gear minimizes backlash and carries the load"] },
      {
        text: "Rollers",
        sub: [
          "Wide 3\" central flywheel",
          "Small 1\" hood rollers to save packaging space",
          "Hood rollers run at 23.8% of the flywheel's surface speed to put backspin on the ball",
          "Inertia wheel acts as a kinetic battery for consistent shots",
        ],
      },
    ],
  },
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

export interface WrittenSection {
  title: string;
  lede?: string;
  features: Feature[];
}

/** Software isn't in the CAD, so this part of the binder is all written. */
export const SOFTWARE: WrittenSection[] = [
  {
    title: "Goals",
    features: [
      { text: "Shoot on the move" },
      { text: "Tune every subsystem for maximum efficiency" },
      { text: "Autos that score as much fuel as possible" },
      { text: "Accurate full-field localization" },
      { text: "Driver assists that make navigation decisions and simplify driving" },
    ],
  },
  {
    title: "Vision",
    lede: "Full-field localization lets us run high-precision autonomous actions even during teleop.",
    features: [
      { text: "PhotonVision", sub: ["6D pose (x, y, z, roll, pitch, yaw) from monocular cameras detecting AprilTags at known locations", "Cameras placed around the robot so as many tags as possible are always in view"] },
      { text: "Hardware", sub: ["4 ThriftyCams: 2 MP black-and-white global shutter, 1600×1304 at 60 FPS", "2 Orange Pi 5 coprocessors, 8-core ARM with a built-in NPU"] },
      { text: "High-framerate cameras keep odometry accurate after disturbances like crossing the bump" },
      { text: "Field calibration", sub: ["We film the field and anchor it to one tag, usually the hub tag, to correct for field inaccuracy"] },
    ],
  },
  {
    title: "Pose estimation",
    lede: "Vision and wheel odometry each have blind spots, so we fuse them.",
    features: [
      { text: "250 Hz wheel odometry over CAN FD", sub: ["Faster than vision, but drifts from encoder error and wheel slip"] },
      { text: "Kalman filter on the roboRIO", sub: ["Fuses PhotonVision and wheel encoder estimates", "Latency compensation and outlier rejection", "Custom heuristics reject bad sensor data automatically"] },
    ],
  },
  {
    title: "Autos",
    lede: "Time-optimal trajectories planned around our robot's dimensions and mechanics.",
    features: [
      { text: "Direction-aware routines", sub: ["As a bump bot we reach the center later, so our autos sweep back around the field for stray fuel"] },
      { text: "DepotTrenchDepotOutpostHub", sub: ["Starts at the top, drives down to the outpost to intake fuel, then to the human player station for more before shooting into the hub"] },
      { text: "OutpostBumpDirectionalIntake", sub: ["Starts in front of the lower bump, crosses it to collect fuel, and sweeps back to the alliance side to shoot", "Also runs mirrored"] },
      { text: "Enough paths to fit our alliance partners' plans" },
    ],
  },
  {
    title: "Teleop",
    lede: "An automated superstructure maximizes fuel throughput and takes load off the driver and operator.",
    features: [
      { text: "Bump assist finds the nearest bump and crosses it from either alliance side, in any direction" },
      { text: "Intakes and shoots at the same time" },
      { text: "Shooting on the move", sub: ["Predicts where the robot is headed from localization and velocity, and adjusts flywheel speed and pivot angle to score"] },
    ],
  },
];
