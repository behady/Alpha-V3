/**
 * A log computation must never fail a successful save. The screens and routes build an activity
 * line's changes after the record is already written; if that building throws (an odd stored
 * value, a shape nobody expected), the save has still happened and must still read as saved.
 *
 * `safeLog(() => diffChanges(...), [])` returns what the builder returns, or the fallback (and a
 * console error) when it throws. `safeEvents(() => appointmentEvents(...))` is the common case.
 */
export function safeLog<T>(build: () => T, fallback: T): T {
  try {
    return build();
  } catch (err) {
    console.error("Activity log: could not describe this change; the save itself went through.", err);
    return fallback;
  }
}

/** A list of events or changes, or none when building them throws. */
export function safeEvents<T>(build: () => T[]): T[] {
  return safeLog(build, [] as T[]);
}
