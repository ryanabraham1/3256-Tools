import { redirect } from "next/navigation";
import { safeReturnPath } from "@/lib/navigation";

export default async function WorkLogin({ searchParams }: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({ next: safeReturnPath(params.next ?? "/work") });
  if (params.error) query.set("error", params.error);
  redirect(`/login?${query}`);
}
