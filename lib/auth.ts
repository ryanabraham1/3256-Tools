import "server-only";
import { getWorkUser } from "./work-auth";

/** Every tool uses the same verified Google account and team access list. */
export async function isAuthed(): Promise<boolean> {
  return (await getWorkUser()) !== null;
}
