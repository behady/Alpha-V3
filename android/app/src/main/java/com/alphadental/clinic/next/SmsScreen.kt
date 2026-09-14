package com.alphadental.clinic.next

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.next.data.SmsSource
import com.alphadental.clinic.next.design.Chip
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.Slab
import com.alphadental.clinic.next.design.SlabIcon
import com.alphadental.clinic.next.design.Stat
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/**
 * Reminders sent as texts from a clinic phone.
 *
 * Written to answer one question before any other: **are patients actually being
 * reminded right now?** Everything else on the screen — the channel, the hour,
 * which events are on — is configuration somebody set once. What changes daily,
 * and what nothing else in the system shouts about, is whether a phone is awake
 * to collect the queue. When it is not, the server stops queueing altogether,
 * so by the time anyone notices, patients have already not been reminded.
 */
@Composable
fun SmsScreen(
    state: Sms,
    onBack: () -> Unit,
    onEnabled: (Boolean) -> Unit,
    onChannel: (SmsSource.Channel) -> Unit,
    onHour: (Int) -> Unit,
    onEvent: (SmsSource.Event, Boolean) -> Unit,
    onFooter: (Boolean) -> Unit,
    onBecomeSender: () -> Unit,
    onStopSending: () -> Unit,
    onCheckNow: () -> Unit,
    onPair: (String) -> Unit,
    onUnpair: () -> Unit,
    onRetire: (String) -> Unit,
) {
    // The two taps on this screen that reach past the phone holding it: one stops
    // every patient reminder the clinic sends, the other takes a handset out of
    // the rota. Both are a single tap and neither is visible from where the
    // consequence lands, so both ask first.
    var confirm by remember { mutableStateOf<Confirm?>(null) }

    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = "Auto SMS",
            eyebrow = when {
                state.loading -> "Reminders"
                state.off -> "Switched off"
                state.notTexting -> "WhatsApp only"
                state.stalled -> "Nothing is collecting the queue"
                else -> "Sending from ${state.liveSenders.size} phone${if (state.liveSenders.size == 1) "" else "s"}"
            },
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
            },
            stats = if (state.loading || state.error != null) emptyList() else listOf(
                Stat("Waiting", state.queue.size.toString()),
                Stat("Sent today", state.sentToday.toString() + if (state.sentTodayCapped) "+" else ""),
                Stat("Failed", state.failed.size.toString()),
                Stat("Phones", state.liveSenders.size.toString()),
            ),
        )

        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }

            state.who?.can("access.settings") != true -> Box(
                Modifier.fillMaxSize().padding(T.gutter),
                contentAlignment = Alignment.Center,
            ) {
                Txt(
                    state.error ?: "This account is not allowed to see how the clinic's reminders are set up.",
                    Type.body, T.inkFaint, maxLines = 3,
                )
            }

            else -> LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = T.barClearance),
            ) {
                state.error?.let { item { Note(it, T.dangerTint, T.danger) } }

                // Said at the top, once, in the order a clinic would care about
                // it. Only one of these can be true at a time by construction.
                item { Health(state) }

                item { SectionLabel("This phone") }
                item { ThisPhone(state, onBecomeSender, onStopSending, onCheckNow, onPair, onUnpair) }

                if (state.queue.isNotEmpty()) {
                    item { SectionLabel("Waiting to go out") }
                    item {
                        RowGroup {
                            state.queue.forEachIndexed { i, m ->
                                if (i > 0) Rule()
                                MessageRow(m)
                            }
                        }
                    }
                }

                if (state.failed.isNotEmpty()) {
                    item { SectionLabel("Did not go") }
                    item {
                        RowGroup {
                            state.failed.forEachIndexed { i, m ->
                                if (i > 0) Rule()
                                MessageRow(m)
                            }
                        }
                    }
                }

                item { SectionLabel("What gets sent") }
                item {
                    WhatGetsSent(
                        state = state,
                        onEnabled = { on -> confirm = Confirm.Master(on) },
                        onChannel = onChannel,
                        onHour = onHour,
                        onEvent = onEvent,
                        onFooter = onFooter,
                    )
                }

                item { SectionLabel("Phones that send") }
                item { Senders(state) { id, name -> confirm = Confirm.Retire(id, name) } }

                item {
                    Column(Modifier.padding(horizontal = T.gutter, vertical = 16.dp)) {
                        Txt(
                            "Message wording is edited on the website. A text is billed to the " +
                                "SIM that sends it, and one Arabic character cuts a message from " +
                                "160 characters to 70.",
                            Type.caption, T.inkMuted, maxLines = 4,
                        )
                    }
                }
            }
        }
    }

    confirm?.let { c ->
        Ask(
            title = c.title,
            body = c.body,
            confirm = c.action,
            danger = c.danger,
            onConfirm = {
                when (c) {
                    is Confirm.Master -> onEnabled(c.on)
                    is Confirm.Retire -> onRetire(c.deviceId)
                }
                confirm = null
            },
            onDismiss = { confirm = null },
        )
    }
}

/** A tap whose consequence lands somewhere the person tapping cannot see. */
private sealed interface Confirm {
    val title: String
    val body: String
    val action: String
    val danger: Boolean

    data class Master(val on: Boolean) : Confirm {
        override val title get() = if (on) "Start sending automatically?" else "Stop all automatic messages?"
        override val body
            get() = if (on) {
                "Patients will be messaged about every event switched on below. Anything sent as a " +
                    "text is billed to the SIM that sends it."
            } else {
                "No patient is reminded, told about a change, or sent an invoice until this is " +
                    "switched back on. Nothing warns anybody that it is off."
            }
        override val action get() = if (on) "Start" else "Stop everything"
        override val danger get() = !on
    }

    data class Retire(val deviceId: String, val name: String) : Confirm {
        override val title get() = "Retire $name?"
        override val body
            get() = "It stops collecting the queue. If it is the last phone, the clinic stops " +
                "queueing reminders at all. Pairing it again brings it back."
        override val action get() = "Retire"
        override val danger get() = true
    }
}

@Composable
private fun Ask(
    title: String,
    body: String,
    confirm: String,
    danger: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = T.surface,
        title = { Txt(title, Type.heading, T.ink, maxLines = 2) },
        text = { Txt(body, Type.body, T.inkMuted, maxLines = 6) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Txt(confirm, Type.label, if (danger) T.danger else T.ink)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Txt("Leave it", Type.label, T.inkMuted) }
        },
    )
}

/**
 * Whether reminders are going out at all, in one line.
 *
 * The order matters: a master switch that is off makes every other warning
 * irrelevant, and a channel set to WhatsApp means no phone is ever asked to send
 * no matter how many are alive. Showing all three at once would make a clinic
 * chase the wrong one.
 */
@Composable
private fun Health(state: Sms) {
    when {
        state.off -> Note(
            "Automatic messages are switched off. Nothing is queued for anyone.",
            T.surfaceSoft, T.inkBody,
        )

        state.notTexting -> Note(
            "Patients are messaged on WhatsApp. No text messages are sent, so no phone is needed here.",
            T.surfaceSoft, T.inkBody,
        )

        state.stalled -> Note(
            "${state.queue.size} message${if (state.queue.size == 1) " is" else "s are"} waiting and no " +
                "phone has checked in for an hour. While that is true the clinic queues nothing new " +
                "either — patients booked for tomorrow are not being reminded.",
            T.dangerTint, T.danger,
        )

        state.liveSenders.isEmpty() -> Note(
            "No phone has checked in for an hour. Reminders stop being queued until one does.",
            T.accentTint, T.accentInk,
        )
    }
}

@Composable
private fun Note(text: String, fill: Color, ink: Color) {
    Surface(color = fill, modifier = Modifier.fillMaxWidth()) {
        Txt(text, Type.caption, ink, Modifier.padding(horizontal = T.gutter, vertical = 13.dp), maxLines = 5)
    }
}

/**
 * What this handset is doing.
 *
 * Above the clinic-wide settings on purpose: somebody holding this phone opens
 * this screen to find out whether *it* is the one sending, and that is a
 * different question from how the clinic is configured.
 */
@Composable
private fun ThisPhone(
    state: Sms,
    onBecomeSender: () -> Unit,
    onStopSending: () -> Unit,
    onCheckNow: () -> Unit,
    onPair: (String) -> Unit,
    onUnpair: () -> Unit,
) {
    val phone = state.phone

    // Turning the sender on is the only thing this app asks a permission for, so
    // the request hangs off the switch rather than firing at launch. Refusing it
    // leaves the switch off: a phone listed as the sender that cannot send is
    // worse than no phone, because the server counts it and keeps queueing.
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) onBecomeSender()
    }

    RowGroup {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Txt("Send from this phone", Type.rowName, T.ink)
                Spacer(Modifier.height(2.dp))
                Txt(
                    when {
                        !phone.paired -> "Pair it with the clinic first"
                        !phone.permitted -> "Android has not been given permission to send texts"
                        phone.sender -> "Messages go out on this SIM, and are billed to it"
                        else -> "This phone is not collecting the queue"
                    },
                    Type.caption, T.inkMuted, maxLines = 2,
                )
            }
            Spacer(Modifier.width(12.dp))
            Switch(
                checked = phone.sender && phone.permitted,
                enabled = phone.paired,
                onCheckedChange = { on ->
                    if (!on) onStopSending()
                    else if (phone.permitted) onBecomeSender()
                    else ask.launch(Manifest.permission.SEND_SMS)
                },
                colors = SwitchDefaults.colors(
                    checkedThumbColor = T.onSlab,
                    checkedTrackColor = T.slab,
                    uncheckedThumbColor = T.surface,
                    uncheckedTrackColor = T.line,
                    uncheckedBorderColor = T.lineStrong,
                ),
            )
        }

        if (phone.sender) {
            Rule()
            Row(
                Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    // The worker's own words, not a summary of them. "No mobile
                    // signal when the message was sent" is something a clinic can
                    // act on; "error" is not.
                    Txt(
                        phone.lastResult.ifBlank { "Not run yet — it checks every 15 minutes" },
                        Type.body, T.inkBody, maxLines = 2,
                    )
                    Spacer(Modifier.height(2.dp))
                    Txt(
                        buildString {
                            append(if (phone.lastRunAt > 0) SmsSource.ago(phone.lastRunAt) else "waiting for its first check")
                            if (phone.sentTotal > 0) append(" · ${phone.sentTotal} sent from this phone")
                        },
                        Type.caption, T.inkMuted,
                    )
                }
                Spacer(Modifier.width(10.dp))
                Pill("Check now", onClick = onCheckNow)
            }

            Rule()
            Txt(
                "Leave this phone on, in signal, and out of battery saver. A phone that stops " +
                    "checking in stops the clinic's reminders entirely.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 3,
            )
        }

        Rule()
        Pairing(state, onPair, onUnpair)
    }
}

/**
 * Bind this handset to a clinic with the six digits from the website.
 *
 * The manual handshake exists because the old answer to "which clinic?" was a
 * guess at both ends — the phone used its user's default, the website used the
 * viewer's default, and for anyone in more than one clinic those could disagree.
 * A working sender phone, invisible on the very page meant to show it.
 */
@Composable
private fun Pairing(state: Sms, onPair: (String) -> Unit, onUnpair: () -> Unit) {
    var code by remember { mutableStateOf("") }

    if (state.phone.paired) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Txt("Paired with the clinic", Type.rowName, T.ink)
                Spacer(Modifier.height(2.dp))
                Txt("This phone sends for this clinic and no other", Type.caption, T.inkMuted, maxLines = 2)
            }
            Spacer(Modifier.width(10.dp))
            Pill("Unpair", onClick = onUnpair, danger = true)
        }
        return
    }

    Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp)) {
        Txt("Pair this phone", Type.rowName, T.ink)
        Spacer(Modifier.height(2.dp))
        Txt(
            "On the website: Settings → SMS → \"Pair a phone with a code\"",
            Type.caption, T.inkMuted, maxLines = 2,
        )
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = code,
                onValueChange = { input -> code = input.filter { it.isDigit() }.take(6) },
                placeholder = { Txt("123456", Type.body, T.inkFaint) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                shape = T.cardShape,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = T.surfaceSoft,
                    unfocusedContainerColor = T.surfaceSoft,
                    focusedTextColor = T.ink,
                    unfocusedTextColor = T.ink,
                    focusedIndicatorColor = T.lineStrong,
                    unfocusedIndicatorColor = T.line,
                    cursorColor = T.ink,
                ),
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(10.dp))
            if (state.phone.pairing) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
            } else {
                Pill("Pair", onClick = { if (code.length == 6) onPair(code) }, solid = code.length == 6)
            }
        }
        state.phone.pairError?.let {
            Spacer(Modifier.height(8.dp))
            Txt(it, Type.caption, T.danger, maxLines = 3)
        }
    }
}

/** One message, and what became of it. */
@Composable
private fun MessageRow(m: SmsSource.Outgoing) {
    Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Txt(m.patientName.ifBlank { m.to.ifBlank { "No number" } }, Type.rowName, T.ink, Modifier.weight(1f))
            Spacer(Modifier.width(10.dp))
            when {
                m.failed -> Chip("Failed", T.dangerTint, T.danger)
                m.status == "sending" -> Chip("Sending", Color(0xFFBAE6FD), Color(0xFF075985))
                m.status == "sent" -> Chip("Sent", Color(0xFFA7F3D0), Color(0xFF065F46))
                else -> Chip("Queued", Color(0xFFE2E8F0), Color(0xFF475569))
            }
        }
        Spacer(Modifier.height(3.dp))
        Txt(
            listOfNotNull(
                m.about,
                when {
                    m.failed && m.error.isNotBlank() -> m.error
                    m.status == "sent" -> SmsSource.ago(SmsSource.instantMillis(m.sentAt))
                    m.sendAfter.isNotBlank() -> "held until ${clockOf(m.sendAfter)}"
                    else -> null
                },
                m.attempts.takeIf { it > 1 && m.failed }?.let { "$it attempts" },
            ).joinToString(" · "),
            Type.caption,
            if (m.failed) T.danger else T.inkMuted,
            maxLines = 2,
        )
    }
}

/**
 * The clinic's settings.
 *
 * Editable to admins, which is exactly who Firestore's rules let through. For
 * everybody else the same rows are shown and read as facts, because a
 * receptionist wondering why a patient was not texted deserves to see how the
 * clinic is set up even if they may not change it.
 */
@Composable
private fun WhatGetsSent(
    state: Sms,
    onEnabled: (Boolean) -> Unit,
    onChannel: (SmsSource.Channel) -> Unit,
    onHour: (Int) -> Unit,
    onEvent: (SmsSource.Event, Boolean) -> Unit,
    onFooter: (Boolean) -> Unit,
) {
    val setup = state.setup
    val editable = state.canEdit

    RowGroup {
        Toggle(
            title = "Automatic messages",
            caption = if (setup.enabled) {
                "On. Patients are messaged about the events below."
            } else {
                "Off. Nothing is queued for anyone, whatever else is set here."
            },
            checked = setup.enabled,
            enabled = editable,
            onChange = onEnabled,
        )

        Rule()
        Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp)) {
            Txt("How patients are messaged", Type.rowName, T.ink)
            Spacer(Modifier.height(9.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SmsSource.Channel.entries.forEach { c ->
                    val on = c == setup.channel
                    Surface(
                        shape = T.pill,
                        color = if (on) T.slab else T.surface,
                        border = if (on) null else BorderStroke(1.dp, T.line),
                        modifier = Modifier.then(
                            if (editable) Modifier.clickable { onChannel(c) } else Modifier
                        ),
                    ) {
                        Txt(
                            c.label,
                            Type.label.copy(fontSize = 12.sp),
                            if (on) T.onSlab else T.inkMuted,
                            Modifier.padding(horizontal = 13.dp, vertical = 8.dp),
                        )
                    }
                }
            }
            Spacer(Modifier.height(7.dp))
            Txt(setup.channel.caption, Type.caption, T.inkMuted, maxLines = 2)
        }

        Rule()
        Row(
            Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Txt("Reminders go out at", Type.rowName, T.ink)
                Spacer(Modifier.height(2.dp))
                // The floor is not arbitrary: the nightly sweep runs before dawn,
                // and an hour it has already passed could not be honoured on the
                // day it was queued.
                Txt(
                    "Between ${SmsSource.MIN_SEND_HOUR}:00 and ${SmsSource.MAX_SEND_HOUR}:00, the clinic's own time",
                    Type.caption, T.inkMuted, maxLines = 2,
                )
            }
            Spacer(Modifier.width(10.dp))
            if (editable) {
                Pill("−", onClick = { onHour(setup.sendHour - 1) })
                Spacer(Modifier.width(8.dp))
            }
            Txt(setup.sendHourLabel, Type.label.copy(fontSize = 15.sp), T.ink)
            if (editable) {
                Spacer(Modifier.width(8.dp))
                Pill("+", onClick = { onHour(setup.sendHour + 1) })
            }
        }

        Rule()
        SectionNote("Which moments")
        SmsSource.Event.entries.forEach { e ->
            Rule()
            Toggle(
                title = e.label,
                caption = e.caption,
                checked = setup.sends(e),
                enabled = editable,
                onChange = { onEvent(e, it) },
                trailing = {
                    val body = setup.body(e)
                    if (body.isNotBlank()) {
                        val cost = SmsSource.measure(body)
                        Txt(
                            if (cost.segments <= 1) "1 text" else "${cost.segments} texts",
                            Type.chip,
                            if (cost.segments > 1) T.warn else T.inkFaint,
                            uppercase = true,
                        )
                    }
                },
            )
        }

        Rule()
        Toggle(
            title = "Add \"reply to stop\"",
            // The cost, at the switch, not behind it. This is the one setting on
            // the screen that silently doubles a clinic's phone bill: the default
            // bodies are written to land just inside the 70 characters an Arabic
            // text gets, so the footer always pushes them into a second segment.
            caption = if (setup.optOutFooter) {
                "On. It usually pushes a text into a second billed message."
            } else {
                "Off. Turning it on usually doubles what each text costs."
            },
            checked = setup.optOutFooter,
            enabled = editable,
            onChange = onFooter,
        )

        if (!editable) {
            Rule()
            Txt(
                "Only an owner or admin can change these.",
                Type.caption, T.inkFaint,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
            )
        }
    }
}

/** Every phone paired to the clinic, and whether it is actually awake. */
@Composable
private fun Senders(state: Sms, onRetire: (String, String) -> Unit) {
    if (state.senders.isEmpty()) {
        RowGroup {
            Txt(
                "No phone has ever paired with this clinic.",
                Type.body, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
                maxLines = 2,
            )
        }
        return
    }

    RowGroup {
        state.senders.forEachIndexed { i, s ->
            if (i > 0) Rule()
            Row(
                Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Txt(s.name, Type.rowName, T.ink)
                    Spacer(Modifier.height(2.dp))
                    Txt(
                        when {
                            !s.enabled -> "Retired"
                            s.alive -> "Checked in ${SmsSource.ago(s.seenMillis)}"
                            else -> "Last seen ${SmsSource.ago(s.seenMillis)}"
                        },
                        Type.caption,
                        if (s.enabled && !s.alive) T.warn else T.inkMuted,
                    )
                }
                Spacer(Modifier.width(10.dp))
                when {
                    !s.enabled -> Chip("Off", T.surfaceSoft, T.inkFaint)
                    s.alive -> Chip("Live", Color(0xFFA7F3D0), Color(0xFF065F46))
                    else -> Chip("Asleep", T.dangerTint, T.danger)
                }
                if (state.canEdit && s.enabled) {
                    Spacer(Modifier.width(8.dp))
                    Pill("Retire", onClick = { onRetire(s.id, s.name) }, danger = true)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

@Composable
private fun Toggle(
    title: String,
    caption: String,
    checked: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Txt(title, Type.rowName, T.ink)
                if (trailing != null) {
                    Spacer(Modifier.width(8.dp))
                    trailing()
                }
            }
            Spacer(Modifier.height(2.dp))
            Txt(caption, Type.caption, T.inkMuted, maxLines = 3)
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = checked,
            enabled = enabled,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = T.onSlab,
                checkedTrackColor = T.slab,
                uncheckedThumbColor = T.surface,
                uncheckedTrackColor = T.line,
                uncheckedBorderColor = T.lineStrong,
                disabledCheckedThumbColor = T.onSlab,
                disabledCheckedTrackColor = T.lineStrong,
                disabledUncheckedThumbColor = T.surface,
                disabledUncheckedTrackColor = T.line,
            ),
        )
    }
}

@Composable
private fun SectionNote(text: String) {
    Txt(
        text, Type.eyebrow, T.inkFaint,
        Modifier.padding(start = T.gutter, end = T.gutter, top = 14.dp, bottom = 4.dp),
        uppercase = true,
    )
}

@Composable
private fun Pill(label: String, onClick: () -> Unit, solid: Boolean = false, danger: Boolean = false) {
    Surface(
        shape = T.pill,
        color = if (solid) T.slab else T.surface,
        border = if (solid) null else BorderStroke(1.dp, if (danger) T.dangerTint else T.line),
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Txt(
            label,
            Type.label.copy(fontSize = 12.sp),
            when {
                solid -> T.onSlab
                danger -> T.danger
                else -> T.inkMuted
            },
            Modifier.padding(horizontal = 13.dp, vertical = 7.dp),
        )
    }
}

/** "14:00" out of an ISO instant, for a message being held until then. */
private fun clockOf(iso: String): String {
    val millis = SmsSource.instantMillis(iso)
    if (millis <= 0L) return "later"
    return java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(java.util.Date(millis))
}
