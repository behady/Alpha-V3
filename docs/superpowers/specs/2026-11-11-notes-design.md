# Calls become Notes

Agreed with the owner 2026-11-11. Builds on `2026-10-22-call-reminders-design.md`; everything that
spec says still holds unless changed here.

## What the owner asked for

1. The Calls page is renamed **Notes** (ملاحظات) and used for more than calls.
2. The dashboard card shows only the notes that concern the person looking, with a way to see a
   colleague's or everyone's.

## Decisions

- **Every note still belongs to a patient.** No patient-less clinic tasks.
- **Two types, picked in the note window:** 📞 **Call** (the default) and 📝 **Reminder**. The
  reason stays free text (the owner rejected a pick-list in October).
- **Dashboard card switch: Mine · All · a person.** Anyone may switch; the card remembers each
  person's last choice on that device.
  - *Mine* = assigned to me by name, or to my role (Owner counts as Admin, as `resolveRecipients`
    does). A role note only counts as mine when it is for my branch or for no branch.
  - *All* = every open note of the branch on screen (today's behaviour).
  - *A person* = notes assigned to that person by name.

## Storage (no migration)

- The collection stays `clinics/{id}/call_reminders`, the route stays `/api/call-reminders`, the
  event ids stay `callReminderDue` / `callRemindersMissed`, the nav key stays `calls`.
- One new field: `kind: "call" | "reminder"`. A document without it is a **call** — every reminder
  already stored reads as a Call note, unchanged.
- `kind` is set on create, may be changed by `edit`, and is copied by "again" (reschedule).
  Anything other than `"reminder"` sent to the route is stored as `"call"`.
- Firestore rules: no change (the browser never writes this collection).

## Screens

| Where | Change |
|---|---|
| Menu | label "Notes" / "الملاحظات", icon StickyNote, href `/notes` |
| `/notes` | the old Calls page, retitled; adds a type filter (All / Calls / Reminders); empty text "No notes here" |
| `/calls` | redirects to `/notes`, keeping `?id=` so old WhatsApp links and bell items still land on the note |
| Note window | Call / Reminder switch at the top; title "New note" / "Edit note"; reason placeholder follows the type |
| Row | Call: phone icon, "Call again". Reminder: no phone icon, "Remind again", a small 📝 tag. Done and Book on both |
| Dashboard card | title "Today's notes" / "ملاحظات النهارده"; Mine · All · person switch; link "All notes"; hidden when nobody has a note due; when others do but the chosen view is empty it shows "Nothing for you today" so the switch stays reachable |
| Patient file panel | heading "Notes"; each line shows its type |
| Buttons in patient file, booking pop-up, treatment card | "Add note" / "ملاحظة" |

## Alerts

- New links point at `/notes?id=…`.
- Due alert: title "📞 تذكير بمكالمة" for a call, "📝 تذكير" for a reminder; the WhatsApp text's first
  line follows the same rule. Everything else in the text is unchanged.
- Evening summary: "⚠️ N ملاحظات ما اتعملتش النهارده" — one list for both types.
- Who is alerted, when, quiet hours: unchanged.

## Not touched

Android (frozen), the WhatsApp brain, money, rules, indexes, the sweep's timing and recipients.

## Tests

- `tests/callReminders.test.mts`: `kind` defaults to call for an old document; the new pure
  `isMine(row, me)` filter (person, role, Owner→Admin, branch); the reminder WhatsApp wording;
  the menu now links `/notes`.
- `tests/callRemindersRoute.test.mts`: create stores `kind`; junk becomes call; edit changes it;
  reschedule copies it.
- `tests/callReminderSweep.test.mts`: links read `/notes?id=`; a reminder's alert title.
- `npx tsc --noEmit`, then the pages checked in the browser.
