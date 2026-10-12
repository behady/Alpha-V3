# Branch finance — testing list

Clinic: DENT INN (two branches: مصر الجديدة and التجمع الخامس). Use **alphadental.app** after the
Vercel build finishes (a few minutes after the push). Tick each line; if one fails, note the step
number and what you saw.

You need three logins: the **owner**, a **receptionist**, and a **dentist**. If you don't have a
spare receptionist account, invite one (Team → Add) before you start.

---

## Part A — Owner sets things up (≈5 min)

- [ ] **A1.** Settings → Branches & rooms. Each branch card has three new fields: *Receipt prefix*,
      *ETA branch code*, *Tax registration (if different)*. Type `HEL` on مصر الجديدة and `TAG` on
      التجمع الخامس. Save. Reload the page → both prefixes are still there.
- [ ] **A2.** On the same page, type `HEL` on **both** branches and Save → you get a red message
      "Two branches share the receipt prefix HEL…" and nothing is saved. Put `TAG` back and Save.
- [ ] **A3.** Team → pick the receptionist → scroll to the new **Branches** section. Untick
      التجمع الخامس so only مصر الجديدة is ticked. It saves as you click (green toast).
- [ ] **A4.** Still on Team → pick yourself (owner). The Branches section says *"Owners and admins
      always see every branch"* with no boxes.
- [ ] **A5.** Settings → Receipt. The "next number" box now says *"Each branch numbers its own
      receipts (Settings → Branches)"* instead of a number.

## Part B — Receptionist with ONE branch (≈10 min)

Log in as the receptionist from A3.

- [ ] **B1.** Dashboard: the branch control at the top of the calendar is a fixed label
      **مصر الجديدة** — no menu, no "All branches".
- [ ] **B2.** Finance, Reports, Patients: the same fixed label is at the top of each page.
- [ ] **B3.** Book a new appointment. In the booking popup the branch/room choice offers only
      مصر الجديدة rooms. Save it.
- [ ] **B4.** Open any test patient → Quick Pay (or Payment tab → Collect) → pay 10 EGP cash.
      The receipt number starts with **HEL-** (e.g. HEL-0001).
- [ ] **B5.** Finance (today): the 10 EGP payment is listed, with no branch name on it (one-branch
      staff see only their branch, so no label is needed).
- [ ] **B6.** Open a patient who was treated at التجمع الخامس (ask the owner which one, or create
      one in Part C first). Her file shows every row; rows from the other branch carry a small
      **التجمع الخامس** label, and those rows have **no Edit / Delete / Discount** buttons for you.
- [ ] **B7.** Finance → add an expense of 5 EGP. It saves (goes to مصر الجديدة). Reports →
      Income tab → the 10 EGP from B4 is there; nothing from the other branch is.

## Part C — Owner on "All branches" and switching (≈10 min)

Log in as the owner.

- [ ] **C1.** Dashboard: the branch control is a menu with **مصر الجديدة / التجمع الخامس / All
      branches**. Pick **All branches**.
- [ ] **C2.** Quick Pay on a test patient → pay 10 EGP → a small **"Which branch?"** box appears
      first. Press **Cancel** → nothing is recorded (Finance total unchanged).
- [ ] **C3.** Repeat and pick **التجمع الخامس** → the receipt starts **TAG-** (TAG-0001).
- [ ] **C4.** Finance under All branches: you see both the HEL payment (B4) and the TAG payment
      (C3), plus a grey line *"N rows from before branches"* (your old test data).
- [ ] **C5.** Switch the branch control to **مصر الجديدة** → the TAG payment disappears and the
      totals drop. Switch to **التجمع الخامس** → only the TAG payment. Back to All → both.
- [ ] **C6.** Reports → Income (or Clinic) tab → switch branches the same way → figures follow.
      Export to Excel under a branch → the sheet has a **Branch** column.
- [ ] **C7.** Owner view (Owner tab at the top) → under a branch the cash figures follow the
      branch and the target bars say *"Targets are set for the whole clinic"*. Under All, the
      targets are back.
- [ ] **C8.** Team → a dentist who worked at both branches → switch branches → "Work done" and
      the share change per branch. Make a payout under مصر الجديدة → the payout row shows the
      branch name in the Money tab.
- [ ] **C9.** Open the TAG patient's file (C3) → Finance tab → every row shows, the TAG row has a
      **التجمع الخامس** label, and as owner you CAN edit/delete it.
- [ ] **C10.** Booking popup under All branches → Payment tab → Collect → the "Which branch?"
      box opens → press **Escape** → only the box closes; the booking popup stays open.

## Part D — Dentist (≈3 min)

Log in as a dentist (no branches unticked).

- [ ] **D1.** Dashboard → the branch menu lists both branches but **no "All branches"**.
- [ ] **D2.** Open a patient with debt at both branches → the owed figure on the Dentist home is
      the whole account (not just one branch).

## Part E — Phone app (≈3 min, optional)

- [ ] **E1.** On the Android app, as the receptionist, record a payment for a patient treated at
      مصر الجديدة. On the website that payment appears under مصر الجديدة with a HEL- receipt.
      (The phone sends no branch; the server works it out from the treatment.)

---

## If something fails

Tell me the step number (e.g. "C5 — totals didn't change") and, if there was a red message, its
text. Don't delete the test rows yet; they help me see what happened.

## Cleaning up after the test

Delete the test payments/expenses from each patient's Finance tab (owner) and the 5 EGP expense
from Finance. The receipt counters keep counting from where they are — that is expected.

---

## Part F — Finance page tabs (owner, ≈8 min)

- [ ] **F1.** Finance: at the top there are branch tabs **مصر الجديدة · التجمع الخامس · All branches**.
      Click التجمع الخامس → go to the Dashboard → the calendar is on التجمع الخامس too (one shared
      choice). Come back; click All branches.
- [ ] **F2.** Under the branch tabs there is a second row: **Clinic · Gasco · MetLife · NextCare**
      (one per insurance company you have). Reload the page → it reopens on the same tab.
- [ ] **F3.** Clinic tab: the list switch now reads *Summary · Income · Payments · Other income ·
      Expenses*. Choose **Income** → the rows add up to the "Cash in" tile above.
- [ ] **F4.** Clinic tab: open **Filters**. You can filter by kind, paid by (cash/card/Instapay/
      insurance), who pays (patient / each company), dentist, patient name or phone, expense
      category, received by, receipt number and amount range. Set two at once → the list and the
      tiles both change. **Clear** → everything comes back.
- [ ] **F5.** Clinic tab: a cash payment on a Gasco treatment shows *"for a Gasco treatment"* under
      it; after F7 the company's payment shows *"Gasco paid"* with the Gasco badge.
- [ ] **F6.** **Gasco** tab: it opens on everything Gasco still owes, any date ("Only outstanding"
      is on). The strip shows Billed · Patient paid · Company paid · Outstanding for the company's
      whole account, any date. Untick "Only outstanding" → settled rows appear too (the MTA row,
      paid in full in cash by the patient, shows there with its split).
- [ ] **F7.** Tick one row → **Mark collected** → confirm → green toast with the receipt number.
      The receipt starts with the prefix of the branch the treatment was done in (HEL- or TAG-),
      whatever branch tab you are on. The row's status turns **Collected**.
- [ ] **F8.** **Select all outstanding** → the sticky bar at the bottom says *Mark N selected
      collected (total)* → confirm → all rows turn Collected. Press it again with nothing
      outstanding → "Nothing to collect".
- [ ] **F9.** A row whose treatment has no dentist is greyed with *"No dentist on this treatment"*
      and cannot be ticked. A MetLife/NextCare row that came from an approval says *"On the
      Insurance page"* instead of a button.
- [ ] **F10.** Log in as a receptionist with one branch: no branch tabs (fixed label), the company
      tabs are there, but she cannot collect a treatment done at the other branch (it is not in her
      view at all).
