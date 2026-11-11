import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import { AdvantageScope } from "@/components/robot-logs/advantagescope";
import "@/components/robot-logs/advantagescope.css";
export default async function ScopePage({ searchParams }: { searchParams: Promise<{ log?: string }> }) {
  const { log } = await searchParams;
  if (!(await isAuthed())) redirect(`/login?next=${encodeURIComponent('/logs/advantagescope' + (log ? '?log=' + encodeURIComponent(log) : ''))}`);
  return <AdvantageScope log={typeof log === "string" && /^[a-f0-9]{64}$/.test(log) ? log : null} />;
}
