import { RobotLogs } from "@/components/robot-logs/viewer";
import { getWorkUser } from "@/lib/work-auth";
import "@/components/robot-logs/logs.css";
export default async function RobotLogsPage() {
  const user = await getWorkUser();
  return <RobotLogs canDelete={user?.role === "admin"} />;
}
