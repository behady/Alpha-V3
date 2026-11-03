/**
 * Meta's canned click-to-WhatsApp opener.
 *
 * When a patient taps a Facebook/Instagram ad, WhatsApp opens with a pre-filled line such as
 * "Hello! Can I get more info on this?" and most people send it as is. The patient never typed
 * it, so it says nothing about the language they speak: Asnany's Arabic-only bot answered eight
 * ad chats in English because that line was read as an English message. Everything that decides
 * language from the patient's text asks here first.
 */
const CANNED =
  /^(?:(?:hello|hi|hey)[!,.\s]*)?(?:can i (?:get|have) (?:some )?more (?:info|information|details)(?: on| about)?(?: this| that| it)?|i(?:'m| am) interested(?: in (?:this|that|it|your [a-z ]{1,40}))?|i(?:'d| would) like to know more(?: about (?:this|that|it|your [a-z ]{1,40}))?|i want to know more(?: about (?:this|that|it|your [a-z ]{1,40}))?|(?:can you )?(?:tell|send) me more(?: (?:info|information|details))?(?: about (?:this|that|it|your [a-z ]{1,40}))?)[\s!?.]*$/i;

/** True for the exact pre-filled ad openers (English); a patient's own English sentence is not one. */
export function isCannedAdGreeting(text: string): boolean {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 120) return false;
  return CANNED.test(t);
}
