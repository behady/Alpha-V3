package com.alphadental.clinic.next

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.ClinicSettings
import com.alphadental.clinic.next.data.Pricing
import com.alphadental.clinic.next.design.Chip
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/**
 * Settings → Payers & insurance, as the website has it.
 *
 * Three things, in the website's order: the insurers themselves (each with the price list it
 * bills on and the treatments it covers), then what each dentist earns on each insurer's work.
 * The prices ON an insurer's list are typed on the Price list page, one field per list, because
 * that is where a price is a price.
 *
 * Setting up an insurer is the website's three questions: what is it called, whose prices does it
 * pay (its own list, made for it), and which treatments does it pay for. Nothing here is written
 * until Save; a payer is retired rather than deleted, so old cases keep their label.
 */
@Composable
internal fun PayersPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    val policy = state.pricing
    var editing by remember { mutableStateOf<Pricing.Payer?>(null) }
    var rating by remember { mutableStateOf<ClinicSettings.StaffRates?>(null) }

    editing?.let { payer ->
        PayerEditor(payer, state, onBack = { editing = null }) { saved ->
            actions.savePayer(saved)
            editing = null
        }
        return
    }
    rating?.let { person ->
        RatesEditor(person, state, onBack = { rating = null }) { rates ->
            actions.saveRates(person.id, rates)
            rating = null
        }
        return
    }

    val insurers = policy?.payers?.filter { it.id != Pricing.PRIVATE }.orEmpty()
    SettingsPage(
        title = Section.Payers.label,
        caption = if (policy == null) "Reading…" else if (insurers.isEmpty()) "Private patients only" else "${insurers.size} insurer" + (if (insurers.size == 1) "" else "s"),
        state = state,
        onBack = onBack,
        ready = policy != null,
    ) {
        if (policy == null) return@SettingsPage
        item { SectionLabel("Who pays") }
        item {
            RowGroup {
                policy.payers.forEachIndexed { i, p ->
                    if (i > 0) Rule()
                    val isPrivate = p.id == Pricing.PRIVATE
                    val list = policy.list(p.priceListId)
                    val covered = p.services
                    Row(
                        Modifier.fillMaxWidth()
                            .then(if (!isPrivate && state.canEdit) Modifier.clickable { editing = p } else Modifier)
                            .padding(horizontal = T.gutter, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Txt(p.name, Type.rowName, if (p.active) T.ink else T.inkFaint, maxLines = 1)
                            Spacer(Modifier.height(2.dp))
                            Txt(
                                when {
                                    isPrivate -> "The clinic's own prices. Every clinic has this one."
                                    list == null -> "Charged at the clinic's own prices"
                                    else -> "Prices from “${list.name}”"
                                } + when {
                                    isPrivate -> ""
                                    covered == null -> " · covers every treatment"
                                    else -> " · covers ${covered.size} of ${state.services.size}"
                                },
                                Type.caption, T.inkMuted, maxLines = 2,
                            )
                        }
                        Spacer(Modifier.width(10.dp))
                        if (!p.active) Chip("Retired", T.surfaceSoft, T.inkMuted)
                        else if (p.isDefault && !isPrivate) Chip("Default", T.accentTint, T.accentInk)
                    }
                }
            }
        }
        if (state.canEdit) {
            item {
                Row(Modifier.padding(horizontal = T.gutter, vertical = 10.dp)) {
                    SettingsPill("Add an insurer", solid = true) {
                        editing = Pricing.Payer(id = "", name = "", services = null, active = true)
                    }
                }
            }
        } else {
            item { SettingsReadOnly() }
        }
        item {
            Txt(
                "The price list is the insurer. Charge a treatment on AXA's list and it is AXA's case: " +
                    "AXA's prices, AXA's column in the reports, and the dentist's AXA percentage. " +
                    "Type each list's prices on the Price list page.",
                Type.caption, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 8.dp), maxLines = 5,
            )
        }

        if (insurers.any { it.active }) {
            item { SectionLabel("What each dentist earns") }
            item {
                RowGroup {
                    if (state.rates.isEmpty()) SettingsEmpty("No dentists on the staff list yet.")
                    state.rates.forEachIndexed { i, person ->
                        if (i > 0) Rule()
                        Row(
                            Modifier.fillMaxWidth()
                                .then(if (state.canEdit) Modifier.clickable { rating = person } else Modifier)
                                .padding(horizontal = T.gutter, vertical = 13.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Txt(person.name, Type.rowName, T.ink, maxLines = 1)
                                Spacer(Modifier.height(2.dp))
                                Txt(
                                    insurers.filter { it.active }.joinToString(" · ") { p ->
                                        val own = person.commissionByPayer[p.id]
                                        "${p.name} ${if (own == null) "usual" else "${plain(own)}%"}"
                                    },
                                    Type.caption, T.inkMuted, maxLines = 3,
                                )
                            }
                            Spacer(Modifier.width(10.dp))
                            Txt("${plain(person.commissionPercentage)}%", Type.label.copy(fontSize = 13.sp), T.ink)
                        }
                    }
                }
            }
            item {
                Txt(
                    "The figure on the right is what the dentist usually keeps. An insurer with no figure of " +
                        "its own pays the usual rate; a 0 is a real answer and pays nothing. A change applies to " +
                        "work from now on — nothing already paid is re-split.",
                    Type.caption, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 8.dp), maxLines = 5,
                )
            }
        }
    }
}

/** One insurer: its name, whose prices it pays, and what it covers. */
@Composable
private fun PayerEditor(payer: Pricing.Payer, state: SettingsState, onBack: () -> Unit, onSave: (Pricing.Payer) -> Unit) {
    BackHandler { onBack() }
    val policy = state.pricing ?: return
    val isNew = payer.id.isBlank()
    var name by remember(payer.id) { mutableStateOf(payer.name) }
    var nameAr by remember(payer.id) { mutableStateOf(payer.nameAr) }
    var active by remember(payer.id) { mutableStateOf(payer.active) }
    var isDefault by remember(payer.id) { mutableStateOf(payer.isDefault) }
    // "" = its own list, made for it (the website's default); otherwise an existing list's id.
    var listId by remember(payer.id) { mutableStateOf(payer.priceListId.takeIf { id -> policy.lists.any { it.id == id && it.id != "payer-${payer.id}" } } ?: "") }
    // null = covers every treatment. A set = exactly these.
    var covered by remember(payer.id) { mutableStateOf(payer.services?.toSet()) }

    val edited = payer.copy(
        name = name.trim(), nameAr = nameAr.trim(), active = active, isDefault = isDefault,
        priceListId = listId, services = covered?.toList(),
    )
    val dirty = isNew || edited != payer.copy(priceListId = listId.ifBlank { payer.priceListId })
    val ownedByAnother = { id: String -> policy.payers.any { it.id != payer.id && it.priceListId == id && it.active } }

    SettingsPage(
        title = name.ifBlank { "New insurer" },
        caption = if (isNew) "Not saved yet" else if (active) "Active" else "Retired",
        state = state,
        onBack = onBack,
    ) {
        item {
            RowGroup {
                SettingsField("Name", name, { name = it }, state.canEdit, hint = "AXA Egypt")
                SettingsField("Arabic name", nameAr, { nameAr = it }, state.canEdit, hint = "أكسا")
            }
        }
        item { SectionLabel("Whose prices it pays") }
        item {
            RowGroup {
                ListChoice("Its own list", "A list named after it, priced on the Price list page", listId.isEmpty(), state.canEdit) { listId = "" }
                policy.lists.filter { it.active && it.id != "payer-${payer.id}" }.forEach { l ->
                    Rule()
                    val taken = ownedByAnother(l.id)
                    ListChoice(
                        l.name,
                        when { taken -> "Already another insurer's list"; l.isDefault -> "The clinic's own prices"; else -> "An existing list" },
                        listId == l.id, state.canEdit && !taken,
                    ) { listId = l.id }
                }
            }
        }
        item { SectionLabel("What it covers") }
        item {
            RowGroup {
                SettingsToggle(
                    title = "Covers every treatment",
                    caption = if (covered == null) "Anything on the price list can be charged to it." else "Only the ticked treatments are offered on its list.",
                    checked = covered == null, enabled = state.canEdit,
                ) { all -> covered = if (all) null else state.services.map { it.id }.toSet() }
                if (covered != null) {
                    state.services.forEach { sv ->
                        Rule()
                        Row(
                            Modifier.fillMaxWidth()
                                .then(if (state.canEdit) Modifier.clickable { covered = if (sv.id in covered!!) covered!! - sv.id else covered!! + sv.id } else Modifier)
                                .padding(start = 8.dp, end = T.gutter),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(checked = sv.id in covered!!, onCheckedChange = null, enabled = state.canEdit, colors = CheckboxDefaults.colors(checkedColor = T.slab))
                            Txt(sv.name, Type.body, T.ink, Modifier.weight(1f), maxLines = 2)
                        }
                    }
                }
            }
        }
        item { SectionLabel("Standing") }
        item {
            RowGroup {
                SettingsToggle("Active", if (active) "Offered on new treatments." else "Retired: kept on old cases, offered on nothing new.", active, state.canEdit) { active = it }
                Rule()
                SettingsToggle("Preselected", if (isDefault) "New treatments start on this insurer." else "New treatments start on Private.", isDefault, state.canEdit && active) { isDefault = it }
            }
        }
        item {
            SettingsSave(dirty = dirty, enabled = state.canEdit && name.isNotBlank()) { onSave(edited) }
        }
    }
}

@Composable
private fun ListChoice(title: String, caption: String, chosen: Boolean, enabled: Boolean, onPick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().then(if (enabled) Modifier.clickable(onClick = onPick) else Modifier).padding(horizontal = T.gutter, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Txt(title, Type.rowName, if (enabled) T.ink else T.inkFaint)
            Spacer(Modifier.height(2.dp))
            Txt(caption, Type.caption, T.inkMuted, maxLines = 2)
        }
        Spacer(Modifier.width(10.dp))
        if (chosen) Chip("Chosen", T.accentTint, T.accentInk)
    }
}

/** One dentist: the percentage they keep on each insurer's work. Blank means their usual rate. */
@Composable
private fun RatesEditor(person: ClinicSettings.StaffRates, state: SettingsState, onBack: () -> Unit, onSave: (Map<String, Double?>) -> Unit) {
    BackHandler { onBack() }
    val insurers = state.pricing?.payers?.filter { it.id != Pricing.PRIVATE && it.active }.orEmpty()
    var rates by remember(person.id) { mutableStateOf(insurers.associate { p -> p.id to (person.commissionByPayer[p.id]?.let(::plain) ?: "") }) }
    val parsed = rates.mapValues { (_, v) -> v.trim().toDoubleOrNull() }
    val valid = parsed.values.all { it == null || it in 0.0..100.0 }
    val dirty = insurers.any { p -> parsed[p.id] != person.commissionByPayer[p.id] }

    SettingsPage(title = person.name, caption = "Usually keeps ${plain(person.commissionPercentage)}%", state = state, onBack = onBack) {
        item {
            RowGroup {
                insurers.forEach { p ->
                    SettingsField(
                        "% on ${p.name}", rates[p.id].orEmpty(),
                        { v -> rates = rates + (p.id to v.filter { c -> c.isDigit() || c == '.' }) },
                        state.canEdit, numeric = true, hint = "usual · ${plain(person.commissionPercentage)}%",
                    )
                }
            }
        }
        item {
            Txt(
                "Leave a box empty for the usual rate. Type 0 to pay nothing on that insurer's work — a " +
                    "different answer, not a missing one.",
                Type.caption, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 8.dp), maxLines = 3,
            )
        }
        item { SettingsSave(dirty = dirty, enabled = state.canEdit && valid) { onSave(parsed) } }
    }
}

private fun plain(v: Double): String = if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()
