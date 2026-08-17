---
title: Working hours and days off
summary: The opening times the calendar offers, and the geofence that staff clock in against.
section: settings
order: 2
roles: Admin
---

Two settings that quietly control a lot: when the calendar will let you book, and where staff are allowed to clock in from.

## Opening hours

**Settings → Schedule**

![Clinic schedule — opening time, closing time, slot duration and days off](/help/en/clinic-schedule.png)

| Setting | What it does |
|---|---|
| **Opening time** | Earliest bookable time |
| **Closing time** | Latest bookable time |
| **Slot duration** | 15 / 30 / 45 minutes or 1 hour — the spacing of the times offered when booking |
| **Days off (weekend)** | Tick every day you're closed |

Press **Save Schedule**.

### What this actually affects

The booking screen only offers times **inside** these hours. If reception says a time "isn't in the list", this is why — not a bug.

Days off drive the *"Clinic closed this day"* warning when booking. That warning **asks rather than blocks**, so you can still book an exception, but it stops accidental Friday bookings.

### Slot duration is spacing, not appointment length

A 30-minute slot duration means the times offered are 09:00, 09:30, 10:00. It does **not** mean every appointment is 30 minutes — the length comes from the treatment's typical duration, or whatever you pick when booking.

Set it to how precisely you want to schedule. Fifteen minutes gives fine control and a long dropdown; an hour is tidy but forces everything onto the hour.

## Where staff can clock in from

**Settings → Attendance**

![Attendance geofencing — latitude, longitude and allowed radius](/help/en/attendance-geofence.png)

This is **geofencing**: it restricts clock-ins to the clinic's actual physical location.

1. Stand in the clinic.
2. Press **Auto-Capture GPS** — it fills in latitude and longitude for you.
3. Set the **allowed radius in metres**.
4. Press **Save Geofence**.

### Getting the radius right

Too small and staff standing inside your clinic can't clock in. Too large and they can clock in from the café over the road.

Start around **50–100 metres** and adjust. Phone GPS is only accurate to a few tens of metres indoors, and a first-floor clinic in a dense street is worse — so a radius that looks generous on a map is often about right in practice.

If staff report that clocking in fails while they're standing at reception, the radius is the first thing to raise.

> Attendance is a paid-plan feature. If the tab isn't there, that's why.

## What's next

Both of these feed the day-to-day screens — see *Book an appointment* and *Staff attendance*.
