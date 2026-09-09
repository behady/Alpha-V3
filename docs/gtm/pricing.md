# Pricing — the plans, and why they are shaped this way

Rebuilt 2026-09-09. The code this describes is `src/lib/subscriptions.ts` (the plan table and the
quota rule), `src/lib/aiQuota.ts` (the one place a credit is reserved and charged) and
`src/lib/platformCost.ts` (our margin). Every number here is also asserted in
`tests/subscriptions.test.mts`, so the doc and the code cannot drift without a test failing.

---

## The plans

| | **Starter** | **Plus** | **Clinic** | **Group** |
|---|---|---|---|---|
| Who it's for | off paper / off Excel | the assistant, on a budget | the whole clinic | chains |
| **Monthly-equivalent, EGP** | **350** | **900** | **1,800** | **3,500** |
| Billed annually | 4,200 | 10,800 | 21,600 | 42,000 |
| Billed monthly (+25%) | 440 | 1,125 | 2,250 | 4,375 |
| Staff accounts | 5 | 8 | 15 | unlimited |
| Branches | 1 | 1 | 1 | unlimited |
| Patients, schedule, clinical, finance, reports | ✓ | ✓ | ✓ | ✓ |
| WhatsApp messages (clinic's own Meta account) | written, sent by hand from the clinic phone | automatic | automatic | automatic |
| Android app (offline schedule, check-in, payments, clock) | ✗ | ✓ | ✓ | ✓ |
| Auto-SMS from the clinic's own phone | ✗ | ✓ | ✓ | ✓ |
| Lab case tracking | ✗ | ✓ | ✓ | ✓ |
| **AI receptionist — replies / month** | ✗ | **500** | **1,000** | **2,000** |
| Overage room past the allowance, at 1 EGP / reply | — | +500 | +1,000 | +2,000 |
| Proactive AI: daily brief, recalls, reactivation, revenue recovery, no-shows | ✗ | ✗ | ✓ unmetered | ✓ unmetered |
| Voice notes → clinical records; embedded AI summaries | ✗ | ✗ | ✓ | ✓ |
| Inventory | ✗ | ✗ | ✓ | ✓ |
| Attendance: geofenced clock-in, hours, payroll | ✗ | ✗ | ✓ | ✓ |
| Orthodontic cases | ✗ | ✗ | ✓ | ✓ |
| Meta ad-lead intake + bot salesperson mode | ✗ | ✗ | ✓ | ✓ |
| Marketing studio (text + design) | add-on | add-on | add-on | included |

**Trial:** 14 days at Clinic level with 500 replies and no overage. Two full weeks of the bot as
the front door, so the first thing an owner sees is patients it booked.

**Grandfathered plans.** Clinics still on Basic / Pro / Premium keep the price they agreed to
until renewal and get the new allowances *now*: Basic behaves as Starter, Pro and Premium as
Clinic (both had inventory and attendance, which only Clinic carries), Premium keeping its
unlimited staff. Move them to a current plan at renewal. The superadmin tier picker shows a
legacy plan only on a clinic that is already on it; nothing new goes on one.

## The four decisions behind the table

**1. The only variable cost is the assistant — so that is the only thing metered.**
One AI credit (one WhatsApp reply, one assistant action) costs us $0.0076–0.0103 in Gemini fees,
roughly half a pound at 48 EGP/USD, doubling on 1 January 2027. Everything else costs the same
whether a clinic uses it or not. WhatsApp is *not* our cost: every clinic connects its own Meta
Business account and Meta bills them directly (we show them Meta's real figure in Settings). So
the subscription prices software and the assistant, full stop — there is no message wallet and
no hidden line inside a plan that a recall campaign can blow through.

**2. Allowances are sized so the bot never goes quiet mid-month.**
The old Premium gave 300 replies — eleven a working day. A clinic using the bot as its actual
front door needed ~900 and ran dry on the tenth, at which point patients were handed to the
receptionist the clinic was paying us to replace. Now a clinic that reaches its allowance keeps
working on overage at 1 EGP a reply (about twice our cost), the owner is told once, and only the
plan's overage ceiling — equal to the allowance again — stops it. A clinic that burns through
1,000 replies is our best customer, not a problem to throttle.

**3. Prices are anchored on what the assistant replaces, not on our supplier bill.**
A receptionist costs an Egyptian clinic 4,000–8,000 EGP a month. Clinic at 1,800 is a quarter of
one, or roughly one crown. Worst-case AI cost at full allowance is ~27% of the price on every plan
that has the assistant; the median clinic sits nearer 10%. The margin ceiling in `platformCost.ts`
is 35% — the old 15% was written when the allowance was a tenth of this and is *why* it was
starved.

**4. Each step up is something an owner can point at.**
Starter → Plus is the phone in their pocket, messages that send themselves, the lab tracker and
the assistant. Plus → Clinic is the AI that reads the whole ledger on its own, plus inventory,
attendance and payroll, ortho, and the paid-lead funnel. Clinic → Group is a second branch and the
marketing studio. Nothing is taken away going up.

## Where each switch is enforced

| Feature key | Client | Server |
|---|---|---|
| `aiChat` + allowance + overage | assistant badge, Settings → AI | `lib/aiQuota.ts` — bot, chat, diagnosis, treatment plan, translation, voice, photo |
| `whatsappIntegration` | Settings → WhatsApp | existing automation gate |
| `smsAutoSend` | Settings → SMS tab | `lib/sms/events.ts` (nothing queued), `api/sms/pair`, `api/sms/pairing-code` |
| `androidApp` | app sign-in (see below) | `api/push/register-token` when the app names itself |
| `lab`, `ortho`, `leads` | page gate + nav | — (Firestore-direct modules; same posture as inventory) |
| `inventory`, `attendance` | page gate + nav | `api/payroll` (attendance) |
| `multiBranch` | Settings → Branches, second branch | — |
| `marketingText/Design` | studio + nav | `api/ai/marketing-content` |

**Follow-up for the Android app:** the server refuses `POST /api/push/register-token` with
`platform: "android"` for a plan without the app, but the app does not yet send that field or
read `clinic.features` at sign-in. Until it does, a Starter clinic's staff can still open the app;
the gate is real on the server and cosmetic on the phone. That is a small Kotlin change in
`SettingsScreen.kt` / the sign-in flow.

## Watch-list

- **January 2027.** Flash doubles. Worst case on every AI plan goes to ~55%. Two mitigations,
  neither urgent today: route the bot's cheap turns (quick answers, classification) to Flash-Lite,
  which has no scheduled rise; and a modest 2027 price step.
- **`overCeiling()` weekly.** It flags a clinic whose AI spend passed 35% of its price. Above it,
  the clinic is on the wrong plan or is the heaviest user on the platform — either way, a phone
  call, not a throttle.
- **Legacy clinics at renewal.** Every Basic / Pro / Premium row is a conversation waiting to
  happen. They already have the new allowance; the renewal is where the price catches up.
