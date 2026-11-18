# Insurance page: one drawer per patient (GASCO first, insurers next)

Owner's ask (2026-11-17): "simpler — under each patient a drawer with every service he had, its
log and its finish date (editable), and a button that tells me what goes out on the sheet for the
dates I picked." Agreed on a clickable mock-up (claude.ai artifact "Insurance patient drawer").

## Decisions (owner)

- The "This month / Next month" switch is REMOVED. One rule: a patient's unsent work goes on the
  sheet of the month his LAST service finished, and only once ALL of it is finished.
  (Live check 2026-11-18: no clinic ever used the switch; removing it moves nobody.)
- Each service shows its story: added, every visit, finished, finish-date changes (who, when),
  reopened, sent on which sheet.
- The finish date can be changed in the drawer. Finished by mistake → "Not finished? Undo".
  In progress → "Mark finished" (today).
- A sent month is locked: no date change, no undo, no new date inside it. Fix = Mark not sent first.
- Undo / dates: anyone with patients.edit (same as today's sheet actions).

## GASCO (phase 1)

Pure logic (`lib/insurance/companySheet.ts`): the walk loses `marks`; held reasons stay
`not_finished`, `finished_late`, `moved` (= that month was already sent). New pure helpers:
`treatmentChain` (shared with `chargeDone`), `patientStandings` (each patient's place relative to
the picked range: on it / sent on it / waiting / goes on a later month / all sent earlier), and
`serviceStory` (the timeline events of one charge).

Route `POST /api/insurance/company-sheet`: `mark` is removed; three actions are added, each on the
treatment's speaking card (newest card of its chain):
- `finishDate {noteId, date}` — Completed only; date ≤ today, ≥ the card's own date, not inside a
  sent month; writes `completedDate` + one `finishLog` entry.
- `reopen {noteId}` — Completed → Ongoing, `completedDate` removed, `finishLog` entry.
- `finish {noteId}` — not Completed → Completed today (refused if today's month is sent).
All three refuse a treatment whose charge is on a sent month (`sent_locked`), mirror the status
into the visit's `services[]` entry, and write an activity-log line. Nothing else is written.

UI (Insurance page, GASCO tab): the month panels become a patient list (chip per patient against
the picked dates) + a slide-over drawer + a "What goes on this sheet?" pop-up (per month: will be
sent / not on it and why; Excel; Mark as sent / not sent). Finance's company tab is unchanged.
Reports tab and phone report keep printing the same sheet (the walk without the switch).

## Insurers (phase 2, next)

Same list + drawer + pop-up over approvals, reusing `LineDoneControls` (per-service done date,
delete, restore) and the claims route's existing sent lock.
