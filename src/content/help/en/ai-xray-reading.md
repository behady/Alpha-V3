---
title: AI x-ray reading
summary: Pick a patient's x-rays and get a structured radiographic report to confirm — what it reads, what it costs, and what it will not do.
section: ai
order: 3
roles: Dentist, Admin
plan: Add-on
---

The AI can read a patient's radiographs and write a report the way a radiologist colleague would: what kind of image it is, how good the exposure is, what it sees tooth by tooth, what it sees in the bone and around it, and what it would do next. You confirm or reject each line — the report is decision support, never a diagnosis on its own.

## Where to find it

Open the patient and go to the **X-Rays & Photos** tab.

- **One picture:** open it (tap it, or press **Inspect**), then press **Read with AI** in the top bar.
- **Several pictures together:** tick the boxes on up to **four** images — a bitewing pair and two periapicals, say — and press **Read with AI** in the dark bar that appears above the grid. Reading them together lets the AI compare views of the same tooth.

A dialog shows the pictures you picked. You can type a question for the reader ("patient complains of pain lower right"), and choose **Deep read** for a complex case or a panoramic. Press **Read now**.

## What comes back

The picture comes back at the top of the report with each finding **outlined in a colour** — green for normal, grey for mild, amber for moderate, orange for severe, red for urgent — and the tooth number on the outline. Hover a row in the findings table and its outline lights up on the picture. If the reader was not confident where something sits, it draws nothing rather than guessing.

Below the picture the report has fixed sections, in this order:

| Section | What it holds |
|---|---|
| **Image type and quality** | Periapical, bitewing, panoramic, CBCT slice… and whether the exposure lets it read. A poor image is a finding: the report says what limits it and what retake would fix it |
| **Summary** | Two to four sentences a colleague would say out loud |
| **Findings per tooth** | One row per tooth in **FDI** numbering, with a **severity** (normal → urgent) and a **confidence** (how clearly the image shows it) |
| **General findings** | Bone levels, furcations, sinuses, mandibular canal, TMJ, impactions |
| **Incidental findings** | Things worth knowing that nobody asked about |
| **Differences from the chart** | Every place the picture disagrees with the odontogram — a tooth charted missing that is present, caries the chart does not know about |
| **Recommendations** | Further imaging, chairside tests to correlate, referral, monitoring. Never prices, never a treatment plan |
| **Limitations** | What the image could not settle, and what would |

Every report ends with the same line: *AI-assisted reading — not a diagnosis. It must be reviewed and confirmed by the treating dentist together with the clinical examination.* That line is added by the system, not by the AI, so it cannot be forgotten.

## Confirming the report (signing)

Every finding row has three buttons: **✓ correct**, **✗ wrong**, and **✎ reword**. Give each one a verdict, then press **Sign report**. The signature is what turns the AI text into a clinical document: the PDF gets a "Reviewed and confirmed by Dr …" stamp, and rejected rows are struck through. Unsigned reports appear on the dentist home screen under **X-ray reports awaiting my confirmation**.

If an outline sits on the wrong tooth, press the **pen** button on that row and drag the correct box on the picture. Scroll to zoom in first for precision. The sliders button on the picture adjusts brightness and contrast.

## Adding a finding to the teeth chart

Press the **+** button on a row to chart it. The AI suggests the matching diagnosis from the clinic's own list; pick it or choose another. The diagnosis lands on the odontogram with a dated note naming the report. Nothing is charted unless you press the button.

## Comparing two x-rays over time

Tick exactly two pictures and press **Compare over time** in the dark bar. The older one (by upload date) is read as "before" and the newer as "after", and the report adds a section: improved, unchanged, worse or mixed, with every change listed. Use it to check healing after a root canal or the progress of bone loss.

## Explaining it to the patient

Each report ends with **For the patient**: the same findings in plain words, with no tooth numbers or jargon. Edit the wording if you wish. Once the report is signed, **Send to patient on WhatsApp** sends the outlined picture and that explanation as a PDF. It cannot be sent before signing, and it needs the Clinical PDFs on WhatsApp add-on.

## Reading new x-rays automatically

Under **Settings → AI credits** an admin can switch on **Read x-rays automatically on upload**. Every new X-Ray, Panoramic or CT picture is then read in the background as soon as it is filed. It spends credits per picture, which is why it is off by default.

## Keeping and printing it

Reports are saved into the patient's file automatically. They appear in the **AI x-ray reports** panel at the top of the X-Rays & Photos tab; tap one to reopen it.

From an open report you can:

- **Download PDF** — an A4 report with the outlined pictures, the clinic logo and a signature line for the treating dentist.
- **Copy text** — to paste into a clinical note or a message to a colleague.
- **Delete** — it goes to **Settings → Recently Deleted** like any other record, and can be restored from there.

## What it costs

A reading costs **3 AI credits**; a **Deep read** costs **9**. Credits are only taken when a report actually comes back — a failed reading costs nothing. The month's spend shows under **Settings → AI credits** as *X-ray reading*.

## What it will not do

- **It does not diagnose.** A finding with *high* confidence is still something to confirm against the patient in the chair. Low-confidence rows are the AI telling you it is unsure.
- **It does not write to the chart.** Nothing it says reaches the odontogram or the clinical record until you put it there.
- **It does not read PDFs or DICOM files** yet — only pictures (JPEG, PNG, WebP). Export the image from your sensor software first.
- **It does not see the patient.** A radiograph cannot show pulp vitality or mobility; the recommendations will ask you for those tests when they would change the answer.

## Who can use it

Anyone with clinical access — dentists and admins, or a team member given the **clinical** permission. The add-on itself is switched on per clinic; if you see a padlock on the button, write to the Alpha team from the dialog and it is activated the same day.
