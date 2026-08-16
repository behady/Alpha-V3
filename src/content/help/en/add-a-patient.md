---
title: Add a new patient
summary: Create a patient file — and what to do when two people share one phone number.
section: frontdesk
order: 1
roles: Receptionist, Admin
---

Every patient needs a file before they can be booked, charged, or treated. Making one takes about thirty seconds.

## Where to find it

Press **New Patient** — it's on the dashboard, and at the top of the **Patients** screen.

![The New Patient form with its fields](/help/en/new-patient-form.png)

## What to fill in

Only two things are required. Everything else can wait.

| Field | Required | Notes |
|---|---|---|
| **Patient name** | Yes | |
| **Phone** | Yes | Pick the country first, then type the number without the leading zero |
| **Address** | No | |
| **Date of birth** | No | Worth getting — it drives age in reports |
| **Gender** | No | |
| **How they heard about you** | No | Feeds the patient-sources report |
| **Allergies** | No | Shown in red for a reason — see below |
| **Medical history** | No | Diabetes, hypertension, anything the dentist should know |

## The phone number

The country selector sits beside the phone box, set to **Egypt (+20)** by default. Type the rest of the number without the leading zero — `1001234567`, not `01001234567`.

If you get **"Phone must include country code first"**, the number didn't come out in the right shape. Check you picked a country and left off the leading zero.

Getting this right matters more than it looks: every WhatsApp reminder, booking confirmation and payment message goes to this number in exactly this format. A wrongly-typed number means that patient silently never hears from you again.

## When the phone number already exists

Type a number that belongs to an existing patient and an amber warning appears, naming who already has it and their file number.

![The duplicate phone warning with its confirmation tickbox](/help/en/duplicate-phone-warning.png)

This is normal in family clinics — a mother booking for her children, a husband and wife on one line. To go ahead, tick:

> Yes, create a separate profile with this shared number (e.g., family member)

Then save. **Without ticking it, the save will not go through** — the form will keep telling you to confirm.

Only override it when you genuinely mean to. If it's actually the same person coming back, close the form and search for their existing file instead. Two files for one person means their money and their treatment history end up split across both, and nothing adds up.

## The file number

You don't type one. The system assigns the next one automatically — **PT-1001**, **PT-1002**, and so on — and no two patients can ever get the same number, even if two people at the front desk save at the same moment.

## Allergies

The allergies box is styled in red because it's the one field that can hurt someone. Fill it in if you asked, and leave it **empty** if you didn't — an empty box means "not asked", which is honest. Typing "none" when nobody actually asked is worse than leaving it blank.

## What's next

The patient exists. Now book them in.
