export const dynamic = "force-dynamic";
export const metadata = {
  title: "Work · 3256 Tools",
  description: "Tasks, projects, and initiatives for the WarriorBorgs.",
};
// Every /work/... address is one screen: the layout renders the workspace, which reads the address
// itself, so moving between tasks and pages never waits on the server or loses what was on screen.
export default function WorkPage() {
  return null;
}
