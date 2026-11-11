import { redirect } from "next/navigation";

/**
 * The Calls page became the Notes page on 2026-11-11. Alerts already sent link here with ?id=…,
 * so the address forwards with its query intact and the note still opens highlighted.
 */
export default async function CallsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const id = typeof params.id === "string" ? params.id : "";
  redirect(id ? `/notes?id=${encodeURIComponent(id)}` : "/notes");
}
