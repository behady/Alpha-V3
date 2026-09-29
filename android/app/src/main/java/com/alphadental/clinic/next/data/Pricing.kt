package com.alphadental.clinic.next.data

import com.alphadental.clinic.Firebase
import com.alphadental.clinic.data.Service
import kotlinx.coroutines.tasks.await

/**
 * Who is paying, and at what prices — the website's rule, kept word for word.
 *
 * **The price list IS the insurer.** There is no separate "paid by" question anywhere: charge a
 * treatment on the AXA list and it is AXA's case — AXA's prices, AXA's column in the reports, the
 * dentist's AXA percentage. Charge the next treatment in the same visit on the clinic's own list
 * and that one is private. A list no insurer owns is private work, which is what a clinic that
 * never opens the Payers screen means without saying so.
 *
 * Before this, every treatment recorded from a phone went to the server with no list at all and
 * landed as Private at the standard price, even for an insured patient — see the parity notes.
 * Pure over the two settings documents (`settings/price_lists`, `settings/payers`); the same
 * parsing as `src/lib/priceLists.ts` and `src/lib/payers.ts`, which are the source of truth.
 */
object Pricing {

    const val PRIVATE = "private"
    const val STANDARD = "standard"

    data class PriceList(
        val id: String,
        val name: String,
        val nameAr: String = "",
        val active: Boolean = true,
        val isDefault: Boolean = false,
        /** Blank = clinic-wide, offered at every branch. */
        val branchId: String = "",
        /** Prefilled per-line discount for services picked from this list. Kept so a save cannot lose it. */
        val generalDiscountPercent: Double = 0.0,
    )

    data class Payer(
        val id: String,
        val name: String,
        val nameAr: String = "",
        /** The list this insurer's work is charged from. Blank = the clinic's default (Private). */
        val priceListId: String = "",
        /**
         * The treatments this insurer covers. NULL MEANS ALL — an insurer set up before coverage
         * existed covers everything. An empty list means "covers nothing yet", a different answer.
         */
        val services: List<String>? = null,
        val active: Boolean = true,
        val isDefault: Boolean = false,
    )

    /** Both documents, read together, with the questions a picker asks answered on it. */
    data class Policy(val lists: List<PriceList>, val payers: List<Payer>) {
        val activeLists: List<PriceList> get() = lists.filter { it.active }

        /** Whether the desk has anything to choose. One list means the feature stays invisible. */
        val hasChoice: Boolean get() = activeLists.size > 1

        /** The list to charge from when nobody has said otherwise, at a branch or clinic-wide. */
        fun defaultListId(branchId: String? = null): String {
            val at = if (branchId.isNullOrBlank()) activeLists else activeLists.filter { it.branchId.isBlank() || it.branchId == branchId }
            return at.firstOrNull { it.isDefault && !branchId.isNullOrBlank() && it.branchId == branchId }?.id
                ?: at.firstOrNull { it.isDefault && it.branchId.isBlank() }?.id
                ?: at.firstOrNull { it.isDefault }?.id
                ?: at.firstOrNull()?.id
                ?: STANDARD
        }

        /** A stored id if it is still usable, else the default — a retired list must not resurrect its prices. */
        fun resolve(listId: String?, branchId: String? = null): String =
            listId?.takeIf { id -> activeLists.any { it.id == id } } ?: defaultListId(branchId)

        fun list(id: String?): PriceList? = lists.firstOrNull { it.id == id }

        /** Who pays when a treatment is charged on this list: the active insurer that owns it, else Private. */
        fun payerFor(listId: String?): Payer =
            payers.firstOrNull { it.active && it.priceListId.isNotBlank() && it.priceListId == listId }
                ?: payers.firstOrNull { it.id == PRIVATE }
                ?: Payer(PRIVATE, "Private", "خاص", isDefault = true)

        /** Whether this insurer's list contains this treatment. A list no insurer owns offers everything. */
        fun covers(listId: String?, serviceId: String?): Boolean {
            val payer = payerFor(listId)
            val covered = payer.services ?: return true
            if (serviceId.isNullOrBlank()) return true
            return serviceId in covered
        }

        /** "AXA · AXA Egypt" — the list, and the insurer it bills, as the website's pickers print it. */
        fun label(list: PriceList): String {
            val payer = payerFor(list.id)
            return if (payer.id == PRIVATE || payer.name.equals(list.name, ignoreCase = true)) list.name else "${list.name} · ${payer.name}"
        }

        /** "Charged to: AXA Egypt", the line under every list picker. */
        fun chargedTo(listId: String?): String = "Charged to: " + payerFor(listId).name

        companion object {
            val NONE = Policy(listOf(PriceList(STANDARD, "Standard", isDefault = true)), listOf(Payer(PRIVATE, "Private", "خاص", isDefault = true)))
        }
    }

    /** The price of a treatment on a list: the list's own figure, or the clinic's standard one. */
    fun priceOf(service: Service, listId: String?): Double =
        listId?.let { service.prices[it] } ?: service.price

    /**
     * A stable id for an insurer somebody has just named, unique against the ones already there —
     * the website's rule. Ids end up as map keys on staff records, so only [a-z0-9_-] survive.
     */
    fun idFor(name: String, existing: List<Payer>): String {
        val base = name.trim().lowercase().replace(Regex("[^a-z0-9_-]+"), "-").trim('-').take(48).ifBlank { "payer" }
        if (existing.none { it.id == base }) return base
        for (n in 2 until 200) { val c = "$base-$n"; if (existing.none { it.id == c }) return c }
        return "$base-${System.currentTimeMillis().toString(36)}"
    }

    /**
     * Save an insurer, and the list it bills on, the way the website's wizard does.
     *
     * A payer with no list of its own gets one named after it (`payer-<id>`), appended to the
     * price lists and never the default. Both documents are merged, never replaced, and every
     * optional field is written only when it holds a value — Firestore refuses an undefined and
     * an absent `services` means "covers all", which is a meaning that must survive.
     */
    suspend fun savePayer(clinicId: String, policy: Policy, payer: Payer): Policy {
        val id = payer.id.ifBlank { idFor(payer.name, policy.payers) }
        val listId = payer.priceListId.ifBlank { "payer-$id" }
        val lists = if (policy.lists.any { it.id == listId }) policy.lists
        else policy.lists + PriceList(id = listId, name = payer.name.trim(), nameAr = payer.nameAr.trim(), active = true, isDefault = false)
        val saved = payer.copy(id = id, priceListId = listId)
        val payers = if (policy.payers.any { it.id == id }) policy.payers.map { if (it.id == id) saved else it } else policy.payers + saved
        // One preselected insurer at most; Private is the fallback the parser restores.
        val settled = if (saved.isDefault && saved.active) payers.map { if (it.id != id) it.copy(isDefault = false) else it } else payers
        val clinic = Firebase.db().collection("clinics").document(clinicId)
        clinic.collection("settings").document("price_lists")
            .set(mapOf("lists" to lists.map(::storedList)), com.google.firebase.firestore.SetOptions.merge()).await()
        clinic.collection("settings").document("payers")
            .set(mapOf("payers" to settled.map(::storedPayer)), com.google.firebase.firestore.SetOptions.merge()).await()
        return Policy(parseLists(mapOf("lists" to lists.map(::storedList))), parsePayers(mapOf("payers" to settled.map(::storedPayer))))
    }

    private fun storedList(l: PriceList): Map<String, Any> = buildMap {
        put("id", l.id); put("name", l.name); put("active", l.active); put("isDefault", l.isDefault)
        put("generalDiscountPercent", l.generalDiscountPercent)
        if (l.nameAr.isNotBlank()) put("nameAr", l.nameAr)
        if (l.branchId.isNotBlank()) put("branchId", l.branchId)
    }

    private fun storedPayer(p: Payer): Map<String, Any> = buildMap {
        put("id", p.id); put("name", p.name); put("active", p.active); put("isDefault", p.isDefault)
        if (p.nameAr.isNotBlank()) put("nameAr", p.nameAr)
        if (p.priceListId.isNotBlank()) put("priceListId", p.priceListId)
        p.services?.let { put("services", it) }
    }

    /** Both settings documents, parsed the way the website parses them. */
    suspend fun load(clinicId: String): Policy {
        val clinic = Firebase.db().collection("clinics").document(clinicId)
        val listsDoc = clinic.collection("settings").document("price_lists").get().await()
        val payersDoc = clinic.collection("settings").document("payers").get().await()
        return Policy(parseLists(listsDoc.data), parsePayers(payersDoc.data))
    }

    fun parseLists(data: Map<String, Any?>?): List<PriceList> {
        val raw = (data?.get("lists") as? List<*>).orEmpty().mapNotNull { it as? Map<*, *> }
        val lists = raw.mapNotNull { m ->
            val id = m["id"]?.toString()?.trim().orEmpty()
            val name = m["name"]?.toString()?.trim().orEmpty()
            if (id.isEmpty() || name.isEmpty()) null else PriceList(
                id = id,
                name = name,
                nameAr = m["nameAr"]?.toString()?.trim().orEmpty(),
                active = m["active"] != false,
                isDefault = m["isDefault"] == true,
                branchId = m["branchId"]?.toString()?.trim().orEmpty(),
                generalDiscountPercent = (m["generalDiscountPercent"] as? Number)?.toDouble() ?: 0.0,
            )
        }.distinctBy { it.id }
        if (lists.isEmpty()) return Policy.NONE.lists
        // One default per scope (a branch, or the clinic), as the website enforces.
        val claimed = mutableSetOf<String>()
        val out = lists.map { l ->
            if (l.isDefault && l.active && claimed.add(l.branchId)) l else if (l.isDefault) l.copy(isDefault = false) else l
        }.toMutableList()
        lists.map { it.branchId }.distinct().forEach { scope ->
            if (scope !in claimed) {
                val i = out.indexOfFirst { it.branchId == scope && it.active }
                if (i >= 0) out[i] = out[i].copy(isDefault = true)
            }
        }
        return out
    }

    fun parsePayers(data: Map<String, Any?>?): List<Payer> {
        val raw = (data?.get("payers") as? List<*>).orEmpty().mapNotNull { it as? Map<*, *> }
        val rows = raw.mapNotNull { m ->
            val id = m["id"]?.toString()?.trim()?.lowercase().orEmpty()
            val name = m["name"]?.toString()?.trim().orEmpty()
            if (id.isEmpty() || name.isEmpty()) null else Payer(
                id = id,
                name = name,
                nameAr = m["nameAr"]?.toString()?.trim().orEmpty(),
                priceListId = m["priceListId"]?.toString()?.trim().orEmpty(),
                services = (m["services"] as? List<*>)?.mapNotNull { it?.toString()?.takeIf(String::isNotBlank) },
                active = m["active"] != false,
                isDefault = m["isDefault"] == true,
            )
        }.distinctBy { it.id }.toMutableList()
        // Private is never absent and never inactive; exactly one default among the active rows.
        val privateAt = rows.indexOfFirst { it.id == PRIVATE }
        if (privateAt < 0) rows.add(0, Payer(PRIVATE, "Private", "خاص", isDefault = rows.none { it.isDefault && it.active }))
        else rows[privateAt] = rows[privateAt].copy(active = true)
        var claimed = false
        val out = rows.map { p ->
            if (p.isDefault && p.active && !claimed) { claimed = true; p } else p.copy(isDefault = false)
        }.toMutableList()
        if (!claimed) {
            val i = out.indexOfFirst { it.id == PRIVATE }.takeIf { it >= 0 } ?: out.indexOfFirst { it.active }
            if (i >= 0) out[i] = out[i].copy(isDefault = true)
        }
        return out
    }
}
