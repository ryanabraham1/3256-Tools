import type { WorkItem } from "./work";

/** Every in-range milestone keeps its marker; its label gets the room up to the next marker, or none when that is too tight to read. */
export function labelSlots(milestones: WorkItem[], min: number, max: number, trackWidth: number, maxLabel = 170, minLabel = 44) {
  const sorted = milestones.filter(m => m.data.due && Date.parse(m.data.due) >= min && Date.parse(m.data.due) <= max).sort((a,b) => a.data.due!.localeCompare(b.data.due!));
  const px = (m: WorkItem) => (Date.parse(m.data.due!) - min) / (max - min) * trackWidth;
  return sorted.map((m, i) => {
    const next = sorted[i + 1];
    const room = next ? px(next) - px(m) - 10 : maxLabel;
    const width = Math.min(maxLabel, room);
    return { m, width: width >= minLabel ? width : 0 };
  });
}

/**
 * Milestone labels for the redesigned timeline: each label sits to the right of its
 * marker in one of `lanes` rows, taking the first row where it fits. A label that
 * fits nowhere gets width 0 (marker only; the title stays in its tooltip).
 */
export function laneSlots(milestones: WorkItem[], x: (date: number) => number, trackWidth: number, lanes = 2, maxLabel = 200, gap = 12) {
  const sorted = milestones.filter(m => m.data.due).sort((a, b) => a.data.due!.localeCompare(b.data.due!));
  const ends = Array.from({ length: lanes }, () => -Infinity);
  return sorted.map((m) => {
    const left = x(Date.parse(m.data.due!));
    const want = Math.min(maxLabel, 30 + m.title.length * 7.2, Math.max(0, trackWidth - left - 4));
    const lane = ends.findIndex((end) => end <= left);
    if (lane === -1 || want < 48) return { m, left, lane: lane === -1 ? 0 : lane, width: 0 };
    ends[lane] = left + want + gap;
    return { m, left, lane, width: want };
  });
}
