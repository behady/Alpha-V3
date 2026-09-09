# Market penetration — how Alpha gets from here to a market it owns

Written against what the product actually is on 2026-09-08, and updated 2026-09-09 for the
rebuilt pricing (see `pricing.md` beside this file): a dental clinic system sold in Egypt from
350 to 3,500 EGP a month, whose distinguishing part is an Arabic WhatsApp assistant that talks to
patients and books them, plus scans that run on the clinic's own data (`revenueRecovery`,
`daily-briefing`, `recalls`, `reactivation`, `noshow`).

Every number below comes from the codebase, not from a market report: tier prices and AI
allowances from `src/lib/subscriptions.ts`, the margin rule from `src/lib/platformCost.ts`.
Where this file quotes the old 5,000 / 10,000 EGP prices it is describing the constraint the
strategy was written under; the conclusions hold at the new prices, which were set to remove the
starved-allowance problem section 3 describes.

---

## 1. The premise, checked

The belief driving this plan is "we are the only system offering AI chat and this much AI
power." That is worth stating precisely, because the imprecise version will lose an argument
with a competitor's brochure.

**Not true globally.** Dental Intelligence, Adit, Weave, Curve, Denticon, Overjet and Pearl all
ship AI in some form. A dentist who searches in English will find them.

**Plausibly true in the market Alpha actually sells to**, on three conditions at once:

- Arabic, conversationally, on WhatsApp — not English, not email, not a web widget.
- An assistant that **acts** (books a slot, sends the plan PDF, chases a balance), not one that
  summarises.
- At ~417 EGP/month. The Western products start near $300/month and do not sell here.

So the defensible claim is not "we have AI." It is: **the only Arabic WhatsApp receptionist
that fills a chair, at a price an Egyptian clinic can pay.** That sentence is the whole
positioning. Anything vaguer invites comparison on feature lists, which is a fight against
better-funded products.

## 2. "More AI power" is the wrong wedge

No dentist has ever wanted AI. They want three things, in this order: more booked chairs,
fewer empty ones, and money they are owed but never collected.

The product already contains the strongest possible proof of the third — `scanForLostRevenue`
reads the entire ledger and names the money. Note what `api/ai/revenue-recovery/route.ts`
already decided: **the scan deliberately costs no AI credits**, because metering the one report
that makes a clinic money is self-defeating. That instinct is correct and should be pushed
much further than the product boundary.

**Lead with the number, not the technology.** The pitch is not a demo. It is:

> Give us your patient list and your ledger. In ten minutes we will tell you how much money
> your clinic is owed and how many patients stopped coming without anyone noticing. The report
> is free and yours to keep.

For most clinics that number will exceed 5,000 EGP by an order of magnitude. At that point the
price is not a decision.

## 3. What the price implies about how we can sell

Pro is ~417 EGP/month; Premium ~833. Supplier cost is held under 15% of revenue
(`COST_RATIO_CEILING`). Two consequences follow and they are not negotiable:

1. **No outbound sales team, ever.** No salaried salesperson is repaid by a 5,000 EGP annual
   deal inside a year. Acquisition must be self-serve, referred, or paid for by someone else's
   sales force. Every play below obeys that.
2. **AI is simultaneously the differentiator and the largest cost line.** The current design —
   metered credits (150/300) for reactive chat, free credits for proactive scans — is right:
   the metered half is what a clinic uses casually, the free half is what makes them stay.
   Keep that split when adding features.

There is a way out of the price ceiling that does not involve a price-list argument:
**charge on outcome.** A fee per appointment the bot books, or a share of recovered balances,
sits on top of the subscription and scales with value delivered rather than with what a clinic
thinks software should cost. It is also the only path from ~$17/month to a real ACV.

## 4. The plays, cheapest customer first

### a. The free revenue-leak audit as the front door
Roughly 80% built. Expose `scanForLostRevenue` behind a public page that accepts an Excel
export or a short guided import, returns the report, and requires an account only to *act* on
it. The report is the advertisement; the product is the fix.

### b. Dentist-to-dentist referral — the highest-leverage thing not yet built
`/refer/[clinicId]` already makes patients refer patients, tagged and attributed. The identical
mechanic one level up is missing. Egyptian dentistry is a dense professional network —
syndicate, graduating classes, Facebook groups. Three months free to both sides on a converted
referral. Reuse the funnel that exists; change who the referrer is.

### c. Let the patient traffic advertise
Every `/book`, `/refer` and `/review` page is seen by patients — a population that contains
other dentists, their spouses, and their staff. A quiet attribution line on those pages is
close to free distribution.

### d. Borrow someone else's sales force: labs and distributors
There is already a `lab` module. A dental lab touches 50–200 clinics; an implant or materials
distributor sends a rep into every clinic weekly. Both already do the visiting we cannot afford.
Give them a revenue share and a co-branded onboarding. At this ACV, channel is not one option
among several — it is the only affordable field presence.

### e. New graduates, free for a year
A dentist chooses a practice system roughly once a decade. Egypt graduates thousands of
dentists a year. Free for the first year of practice is the cheapest decade of lock-in
available, and it costs little: a new clinic's AI usage is small.

### f. Treat migration, not competitors, as the thing being displaced
The incumbent is paper, Excel, and old pirated desktop software. Switching cost is the number
one objection and it is not about features. "We import your existing records in 48 hours, we do
it, it costs nothing" removes it — and parsing a decade of inconsistent Excel is a place where
the AI genuinely earns its cost rather than being a talking point. `migrate` exists; make it an
offer, not a screen.

### g. Publish outcomes
`platformTotals` already computes what the platform recovered and what it cost. Quarterly public
numbers — money recovered, appointments the bot booked — beat any feature claim, and no
competitor entering this market can produce them on day one.

## 5. Sequencing — 90 days, not all seven at once

- **Days 0–30:** free leak audit as a public funnel; dentist-to-dentist referral; free
  migration offer. All three reuse code that exists.
- **Days 30–60:** two channel pilots — one lab, one distributor — with a revenue share and
  measurable attribution.
- **Days 60–90:** new-graduate free year; first published outcome numbers.

## 6. Measure landing, not signups

`welcomeJourney.ts` already holds the right discipline: a mission is proved by a fact in the
data, never by a click. Apply the same rule to growth. A clinic is not acquired when it
registers. It is acquired when **the bot books its first patient** — that is the moment the
product has done something the clinic could not do without it, and it is the only leading
indicator of renewal worth watching.

## 7. Risks worth naming

- **Margin knife-edge.** Cheap price plus heavy AI means `overCeiling()` should be read weekly,
  not quarterly. A single clinic using the assistant hard can invert its own economics.
- **"Most AI" has a twelve-month shelf life.** A funded competitor can match a feature list.
  What they cannot copy is accumulated clinic data: the WhatsApp history, and the per-clinic
  playbook `bot-playbook` learns from 50 real conversations. That compounds, and it is the
  actual moat. It is also a marketing line worth using — *your assistant improves every week; a
  new vendor's starts from zero.*
- **A free audit invites tyre-kickers.** Acceptable. The report costs almost nothing to
  produce and disqualifies fast.
