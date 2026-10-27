/**
 * The WhatsApp page tab a moved settings section lives on, from its `movedTo` address.
 * "/chats/bot?step=ai" → "bot". The query string is where a section can ask the tab to open on a
 * particular step; it is not part of the tab's name, and the tour's anchors are named by the tab.
 * Kept in its own file so a test can import it without loading the whole tour.
 */
export function movedTabKey(movedTo: string): string {
  return movedTo.split("?")[0].split("/").pop() ?? "";
}
