import { getSettings } from "@/lib/data";
import { SettingsForm } from "@/components/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettings();
  return (
    <>
      <p className="eyebrow" style={{ color: "var(--muted)" }}>Settings</p>
      <h1 className="display text-3xl sm:text-[34px] mb-5">Thresholds &amp; access</h1>
      <SettingsForm settings={settings} usingEnvCode={!settings.team_code_hash} />
    </>
  );
}
