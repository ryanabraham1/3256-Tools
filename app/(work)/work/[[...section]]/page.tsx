import { WorkWorkspace } from "@/components/work/workspace";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Work · 3256 Tools",
  description: "Issues, projects, and initiatives for the WarriorBorgs.",
};
export default async function WorkPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const {section} = await params;
  const activeSection = section?.[0] ?? "issues";
  return <WorkWorkspace key={`${activeSection}:${section?.[1] ?? ""}`} section={activeSection} entityId={section?.[1]} />;
}
