/**
 * "معاكي سارة من Alpha Dental Clinic" — once.
 *
 * The prompt has said so since the assistant was given a name, and over an eight-message
 * conversation it introduced itself six times anyway: every turn looks like a first turn from
 * inside a single completion. Nothing else in the assistant's writing gives it away as software
 * quite so fast — a receptionist says who they are when they pick up, and then they are just the
 * person you are talking to.
 *
 * So the clause is removed rather than argued about. Only the clause: the greeting around it is
 * the patient's, answering their own "السلام عليكم", and stripping that would replace one
 * inhuman habit with a colder one.
 */

/** Regex-safe, and tolerant of the spacing a model puts around a name. */
function loose(value: string): string {
  return value
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
}

/**
 * Every shape the introduction takes, in both languages.
 *
 * The clinic name is optional throughout: the model drops it as often as it includes it, and
 * "معاكي سارة" on the fifth message is the same tic as the full sentence.
 */
function patterns(personaName: string, clinicName: string): RegExp[] {
  const name = loose(personaName);
  const clinic = clinicName.trim() ? `(?:\\s*(?:من|from)\\s+${loose(clinicName)})?` : "";
  return [
    // "معاكي سارة من العيادة" / "معاك سارة"
    new RegExp(`(?:^|[\\s،,.!؟?])(?:و)?(?:معاك[يى]?|معاكم)\\s+${name}${clinic}\\s*[.،,!]?`, "gi"),
    // "أنا سارة من العيادة" / "انا سارة"
    new RegExp(`(?:^|[\\s،,.!؟?])(?:و)?(?:أنا|انا)\\s+${name}${clinic}\\s*[.،,!]?`, "gi"),
    // "سارة من العيادة معاكي"
    new RegExp(`(?:^|[\\s،,.!؟?])${name}\\s*(?:من|from)\\s+${loose(clinicName || "x")}\\s*(?:معاك[يى]?)?\\s*[.،,!]?`, "gi"),
    // "I'm Sarah from Alpha Dental Clinic" / "This is Sarah"
    new RegExp(`(?:^|[\\s,.!?])(?:I'?m|I am|This is|Here is)\\s+${name}${clinic}\\s*[.,!]?`, "gi"),
    /*
     * The same introduction under a transliterated name.
     *
     * The persona is configured in Arabic ("سارة") and the assistant answers an English patient
     * as "Sarah" — the same person, spelled the way the language spells it, and invisible to a
     * needle built from the configured name. The clinic name is what makes this safe to match on
     * a name we do not know: nobody else introduces themselves as being from this clinic.
     */
    ...(clinicName.trim()
      ? [
          new RegExp(`(?:^|[\\s,.!?])(?:I'?m|I am|This is)\\s+[A-Z][A-Za-z'’]{1,20}\\s+(?:from|at)\\s+${loose(clinicName)}\\s*[.,!]?`, "g"),
          new RegExp(`(?:^|[\\s،,.!؟?])(?:و)?(?:معاك[يى]?|أنا|انا)\\s+\\S{2,20}\\s+من\\s+${loose(clinicName)}\\s*[.،,!]?`, "g"),
        ]
      : []),
  ];
}

/**
 * Remove a self-introduction the patient has already heard.
 *
 * Returns the text unchanged when removing it would leave nothing worth sending — a reply that IS
 * only an introduction is a strange thing to send twice, but sending an empty message is worse.
 */
export function stripRepeatIntro(text: string, personaName: string, clinicName: string): string {
  const raw = String(text || "");
  if (!raw.trim() || !personaName.trim()) return raw;

  let out = raw;
  for (const re of patterns(personaName, clinicName)) {
    out = out.replace(re, (match) => (/^[\s،,.!؟?]/.test(match) ? match[0] : ""));
  }
  if (out === raw) return raw;

  // Tidy what the removal left behind: a dangling comma, a doubled space, a stranded line.
  out = out
    // A comma the clause used to follow now ends the sentence.
    .replace(/[،,][ \t]*$/gm, ".")
    .replace(/[،,][ \t]*(?=[.!؟?])/g, "")
    // Leading punctuation only — never \s, which would eat the blank line between paragraphs.
    .replace(/^[ \t،,]+/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Under twelve characters is a fragment, not a message.
  return out.replace(/[\s.،,!؟?]/g, "").length >= 12 ? out : raw;
}
