# WhatsApp Pro AI — design

Date: 2026-10-31. Status: agreed in conversation, awaiting owner review of this document. Nothing is built.

## 1. Why

The live WhatsApp AI (`src/lib/bot/aiReply.ts`, model `gemini-flash-latest`) is cheap but unreliable: it does not always follow
a clinic's coaching, it reads only the last 16 messages, it gets a pre-picked list of six slots instead of the calendar, and its
learning is a pile of notes appended to an ever-longer prompt with nothing measuring whether a note helped. It sometimes asks a
patient to book when reception already booked them by phone.

The Pro AI replaces it. It is a new brain on **Gemini Pro**, built in its own folder, that answers every patient message itself.

## 2. Decisions (owner, 2026-10-31)

| Topic | Decision |
|---|---|
| What it must fix | All four: more human replies, better selling/closing, much better memory, does more by itself instead of handing off. |
| Model | Gemini Pro, on a **new separate API key** the owner creates (never the production key used today). |
| Old AI | Stays live and untouched during the trial. After a couple of months of testing, the old AI is **deleted** and the Pro AI replaces it. Non-AI bot options (ready answers, clinic scripts) remain. |
| Pricing | Pro replies cost more credits than the old ones; the exact number is set after measuring real cost. Clinics see credits only, never supplier money. |
| Learning approval | Style (tone, wording, what sells) is applied at once. Anything with a fact (price, duration, offer, doctor days, what the clinic does) waits for admin approval. |
| Actions now | Search the whole calendar; read the full patient file; write a note to the file after a chat; book family members and several appointments in one chat. |
| Actions later | Messaging patients first (lead follow-ups, unfinished-plan nudges) — later, behind its own switch, because of QR ban risk and Meta template cost. |
| Persona | Speaks under whatever name the owner sets, as the clinic's receptionist. Never volunteers being an AI, adds no disclaimer. Only when a patient directly asks whether they are talking to an AI / a bot / a real person does it answer honestly in one short line and offer a person from the team. It never claims to be human. |

## 3. Red lines (locked in code — no clinic setting, lesson or owner chat can change them)

1. **No invented prices.** A price may only come from the clinic's price list in the system.
2. **No medicine and no medical advice** beyond the clinic's own approved scripts; red-flag symptoms go to a person at once.
3. **No double booking.** It cannot offer or book a time that is not free, and cannot re-book someone who already has an upcoming appointment unless the patient clearly asks for an extra one.
4. **Persona rule** as in section 2: never brings up being an AI; never denies it when sincerely asked.

Today's code guards (drug guard, number guard, medicine screen, clinical triage, opt-out footer, quiet hours) run on every Pro
reply as a last check before sending.

## 4. How it fits in

- New per-clinic setting next to today's `botMode` (`src/types/whatsapp.ts`): **AI brain = Standard | Pro**. Every clinic starts on Standard. Nothing changes for a clinic until an admin switches it.
- Same pipes: the official Meta number and the own QR gateway (`wa.alphadental.app`) both reach the same webhooks. The gates in front of the AI are unchanged (opt-out, quiet hours, staff took over, credits). Only after them does the switch choose old code or new code.
- New code lives in its own folder (`src/lib/botPro/`), so deleting the old AI later removes the old folder's reply path and leaves Pro intact. Shared pieces (guards, slot finder, booking writer) are imported, not copied.
- **Never silent:** if Gemini Pro errors or takes longer than ~25 s, that one message falls back to the Standard reply (until the old AI is removed; after that, to a short holding reply plus a staff alert).
- Webhook answers immediately; the reply is composed after the response, as today.
- Target time to reply: under ~20 s including the deliberate typing pause.

## 5. Tools the Pro AI can use

Each tool is code we write; the model asks, the code checks and does. All tools are scoped to the one clinic and branch.

| Tool | What it does | Checks in code |
|---|---|---|
| `findSlots` | Search the whole calendar by day, time of day, doctor, service | Only real free slots; respects schedule, branch, doctor days |
| `getPatientFile` | Visits, upcoming appointments, treatment plan, remaining sessions, balance | Only patients matched to this number (see 6.2) |
| `book` / `move` / `cancel` | Same booking writer the old bot uses | Free slot re-checked at write time; double-booking rule |
| `addNote` | Short note into the patient file after the chat | Marked as written by the AI |
| `handoff` | Pass the chat to staff with a reason | Same handoff inbox as today |
| `getPrice` | Price of a service | Only from the price list; nothing else may produce a number |

## 6. Memory — what it reads before every reply

1. **The whole chat with this number**: the last ~40 messages word for word, everything older as a running summary updated after every sitting (today: nightly, 900 characters, last 36 h only).
2. **Every appointment for this person, past and future**, including ones reception booked by phone. Matched four ways: the patient's phone, the phone typed on the appointment, the hidden QR id linked to the file, a second phone on the file.
3. **The patient file**: plan, remaining sessions, balance, last visit.
4. **Family on the same number**: all patients sharing the phone and their appointments.
5. **Only the relevant lessons** for this message (about 10–15), not all of them.

Hard rules: if anyone on the number has an upcoming appointment, the reply starts from it and the booking tool refuses a repeat.
Right before sending, the calendar is checked again in case reception booked during the reply.

## 7. Learning per clinic

Sources: staff answers when they take over; 👎 and staff rewrites; outcomes (booked or went quiet); the owner's coaching and the onboarding chat (section 8).

- Each lesson is tagged **style** or **fact**. Style lessons go live at once. Fact lessons wait in a **Lessons** list (Approve / Edit / Reject).
- The system wins: if a lesson's fact contradicts the price list or schedule, the system's value is used and the clash is shown to the admin.
- Each lesson keeps a score: times used, bookings in those chats, 👎 in those chats. A style lesson that keeps hurting pauses itself and the admin is told. Any lesson can be switched off.
- Weekly line on the clinic's scorecard: what it learned, what waits for approval, booking rate change.
- One clinic's lessons are never used by another. Only the platform owner can promote a lesson to all clinics, by hand.
- Existing approved answers, coaching notes and scripts carry over so nothing is typed twice.

## 8. Onboarding chat for clinics that already have history

When a clinic that has been running a while turns Pro on:

1. **Scan**: Pro reads all stored old chats (QR line: up to 180 days / 200 messages per chat, pulled at link time; Meta line: since connection only) together with bookings that followed. Done in chunks in the background; one-time cost per clinic, measured on the pilot.
2. **Owner chat window**: a normal chat in the app where the AI presents what it learned ("most asked: braces price; patients who asked about implants booked when offered a free consult; you close Fridays") and asks the owner questions to fill gaps and settle conflicts.
3. **It writes its own clinic layer** from that conversation: the clinic's rules, filters (what to hand off, what never to say) and its own prompt section. The owner confirming in the chat counts as approval for facts.
4. The owner can open, read and edit that clinic layer at any time; each version is kept and can be rolled back.
5. Every new version of the clinic layer passes the replay test (section 10) before it goes live.

The owner chat can shape tone, offers, rules and filters, but cannot change the red lines in section 3.

## 9. Owner coaching report (platform owner only)

Weekly, per clinic and across all clinics, Pro reviews its own week and writes:

- where it went wrong, with the real chat lines (weak replies, 👎, staff stepped in, patient went quiet);
- near misses — guards that caught a price, medicine or booking mistake;
- handoffs and why;
- lessons it failed to follow, and why;
- supplier cost per reply and per booking (to set credit prices);
- suggested fixes written as developer instructions.

A **Copy for Claude** button gives the report as one block to paste into Claude Code, where the improvements are built.
Clinics never see this report.

## 10. Testing and rollout

1. **Separate test key and no clinic credits** during development (lesson from the outage that drained 800 credits).
2. **Replay battery**: saved real chats (👎 replies, bot misses, saved test cases) replayed through Pro in dry-run, nothing sent. Code checks the four red lines on every reply; a judge call scores quality and selling. A new prompt or clinic layer ships only if it scores at least as well and breaks no red line.
3. **Test chat** in the app for the owner and an admin.
4. **One pilot clinic for ~2 weeks** on real patients, staff watching; booking rate compared with the old AI.
5. **More clinics**, then — after a couple of months — the old AI is deleted (its reply path, its prompt, its nightly memory job once Pro's replaces it).

## 11. Not in this version

- Messaging patients first (own switch, later).
- Any Android change (the Android app is frozen).
- Changes to the WhatsApp gateway or the Meta connection.

## 12. Open points

- Credits per Pro reply — set after the pilot measures real cost.
- Which clinic is the pilot.
- After the old AI is deleted: is a cheaper AI tier wanted besides Pro, or is it Pro plus the non-AI bot only?
- Which exact Gemini Pro model id, confirmed on the new key at build time.
