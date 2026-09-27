/**
 * The sending rules, as pure functions of time and counts.
 *
 * WhatsApp bans numbers for behaving like machines, and the two cheapest tells are messages at
 * 3 a.m. and a hundred first-contacts on the day a number is linked. Everything here exists to
 * make a clinic's number look like a receptionist: it works clinic hours, it starts slowly on a
 * new number, and it answers people who wrote in without any of those limits — a reply is the
 * one thing WhatsApp never punishes.
 *
 * Two kinds of message, decided per send by `classify`:
 *   reply      — the patient wrote to this number within the last 24 hours. Sent at once, any hour.
 *   proactive  — the clinic is starting (or restarting) the conversation. Clinic hours only,
 *                counted against the number's daily allowance, paced like a person typing.
 */

/** The wall-clock parts of `date` in `tz`. */
export function zonedParts(date, tz) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = {};
  for (const { type, value } of fmt.formatToParts(date)) p[type] = value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    /** `YYYY-MM-DD` in the zone — the key the daily counters are kept under. */
    dayKey: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Is `now` inside the clinic's sending hours? `[startHour, endHour)` in the zone. */
export function inSendWindow(now, { tz, startHour, endHour }) {
  const { hour } = zonedParts(now, tz);
  return hour >= startHour && hour < endHour;
}

/**
 * The next moment the window opens: today at `startHour` if that is still ahead, else tomorrow.
 *
 * Built by subtracting the local time-of-day from `now` and adding the start hour, which lands
 * on the right instant in every case except the two DST-switch days a year, when it can be an
 * hour off. Harmless: every queued item is re-checked against `inSendWindow` before it leaves.
 */
export function nextWindowOpen(now, { tz, startHour }) {
  const { hour, minute, second } = zonedParts(now, tz);
  const sinceMidnight = (hour * 3600 + minute * 60 + second) * 1000;
  let open = now.getTime() - sinceMidnight + startHour * 3600 * 1000;
  if (open <= now.getTime()) open += 24 * 3600 * 1000;
  return new Date(open);
}

/**
 * How many first-contact messages a number may start today, by how long it has been linked.
 *
 * Community consensus is "about 20 a day for a fresh number, growing over a week or two". The
 * curve: base × growth^days, capped. Day 0 → 20, day 3 → 67, day 5 → 150, day 6+ → 200.
 */
export function dailyProactiveCap(daysLinked, { base, growth, max }) {
  const d = Math.max(0, Math.floor(Number(daysLinked) || 0));
  return Math.min(max, Math.floor(base * growth ** d));
}

export function daysBetween(fromMs, toMs) {
  if (!fromMs || !toMs) return 0;
  return Math.max(0, Math.floor((toMs - fromMs) / (24 * 3600 * 1000)));
}

/** A message is a reply if this chat wrote to us within the last 24 hours. */
export function classify(lastInboundAt, now) {
  const at = Number(lastInboundAt) || 0;
  return at && now.getTime() - at < 24 * 3600 * 1000 ? "reply" : "proactive";
}
