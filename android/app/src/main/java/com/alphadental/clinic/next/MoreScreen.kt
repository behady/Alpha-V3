package com.alphadental.clinic.next

import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.PersonSearch
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Science
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Sms
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.next.data.Who
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.Slab
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/**
 * Everything that is not a tab.
 *
 * It opens on who is signed in. That was the first white card in a stack of
 * white cards on the old app, which made the one thing this screen is certain
 * about — whose account this is — look like another setting.
 *
 * A tool the account may not use is not shown at all, rather than shown and
 * refused. A button that opens a screen the server will reject is worse than no
 * button: it teaches people the app is unreliable rather than that they lack a
 * permission.
 */
@Composable
fun MoreScreen(
    state: MoreState,
    onOpen: (Destination) -> Unit,
    onSignOut: () -> Unit,
    onRetry: () -> Unit = {},
) {
    val who = state.who

    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = who?.name?.ifBlank { "Signed in" } ?: "Signed in",
            eyebrow = who?.role?.takeIf { it.isNotBlank() },
        )

        who?.email?.takeIf { it.isNotBlank() }?.let { email ->
            Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
                Txt(email, Type.caption, T.inkMuted, Modifier.padding(horizontal = T.gutter, vertical = 11.dp))
            }
        }

        // Until the account is read, nothing below it can be drawn honestly: a
        // menu built from permissions nobody has fetched yet is a menu missing
        // half its entries, which reads as the app having lost them.
        if (who == null) {
            Unknown(state, onRetry, onSignOut)
            return
        }

        val tools = Destination.entries.filter { it.area == Area.Tool && it.allowed(who) }
        val admin = Destination.entries.filter { it.area == Area.Admin && it.allowed(who) }

        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = T.barClearance),
        ) {
            if (tools.isNotEmpty()) {
                item { SectionLabel("Tools") }
                item { Grid(tools, onOpen) }
            }
            if (admin.isNotEmpty()) {
                item { SectionLabel("Clinic") }
                item {
                    RowGroup {
                        admin.forEachIndexed { i, d ->
                            if (i > 0) Rule()
                            DestinationRow(d) { onOpen(d) }
                        }
                    }
                }
            }

            // Account is a section like the others, not a hand-written list —
            // Language was appearing twice, once from its own group and once
            // from being spelled out here.
            item { SectionLabel("Account") }
            item {
                RowGroup {
                    Destination.entries.filter { it.area == Area.Account && it.allowed(who) }
                        .forEach { d ->
                            DestinationRow(d) { onOpen(d) }
                            Rule()
                        }
                    SignOutRow(onSignOut)
                }
            }
        }
    }
}

/**
 * The account has not been read.
 *
 * Either still being fetched or genuinely unreadable, and the difference is
 * said out loud. Signing out stays reachable throughout: somebody whose profile
 * cannot be read is exactly the person who needs to get out and back in.
 */
@Composable
private fun Unknown(state: MoreState, onRetry: () -> Unit, onSignOut: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = T.gutter),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(80.dp))
        if (state.loading) {
            CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            Spacer(Modifier.height(16.dp))
            Txt("Reading this account\u2026", Type.body, T.inkMuted)
        } else {
            Txt(
                state.error ?: "This account could not be read.",
                Type.body, T.inkBody, maxLines = 4,
            )
            Spacer(Modifier.height(18.dp))
            Surface(
                shape = T.pill,
                color = T.slab,
                modifier = Modifier.clickable(onClick = onRetry),
            ) {
                Txt(
                    "Try again", Type.label, T.onSlab,
                    Modifier.padding(horizontal = 20.dp, vertical = 11.dp),
                )
            }
            Spacer(Modifier.height(10.dp))
            Surface(
                shape = T.pill,
                color = T.surface,
                border = androidx.compose.foundation.BorderStroke(1.dp, T.dangerTint),
                modifier = Modifier.clickable(onClick = onSignOut),
            ) {
                Txt(
                    "Sign out", Type.label, T.danger,
                    Modifier.padding(horizontal = 20.dp, vertical = 11.dp),
                )
            }
        }
    }
}

/**
 * The tools, two across and ruled.
 *
 * Two rather than the four the old app used: at four across a phone every label
 * had to be one short word, which is how "Find money" and "Send list" ended up
 * being the names of things.
 */
@Composable
private fun Grid(items: List<Destination>, onOpen: (Destination) -> Unit) {
    RowGroup {
        items.chunked(2).forEachIndexed { i, pair ->
            if (i > 0) Rule()
            Row(Modifier.height(IntrinsicSize.Min)) {
                ToolCell(pair[0], Modifier.weight(1f), onOpen)
                Box(Modifier.width(1.dp).fillMaxHeight().background(T.line))
                if (pair.size > 1) ToolCell(pair[1], Modifier.weight(1f), onOpen)
                else Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun ToolCell(d: Destination, modifier: Modifier, onOpen: (Destination) -> Unit) {
    Row(
        modifier.clickable { onOpen(d) }.padding(horizontal = 16.dp, vertical = 15.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(d.icon, null, tint = T.inkFaint, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f)) {
            Txt(d.label, Type.label, T.ink)
            if (!d.built) {
                Spacer(Modifier.height(2.dp))
                Txt("On the website", Type.chip, T.inkFaint, uppercase = true)
            }
        }
    }
}

@Composable
private fun DestinationRow(d: Destination, onOpen: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(horizontal = T.gutter, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(d.icon, null, tint = T.inkFaint, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(13.dp))
        Column(Modifier.weight(1f)) {
            Txt(d.label, Type.rowName, T.ink)
            Spacer(Modifier.height(2.dp))
            Txt(if (d.built) d.caption else "On the website", Type.caption, T.inkMuted, maxLines = 2)
        }
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            null,
            tint = T.lineStrong,
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
private fun SignOutRow(onSignOut: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onSignOut).padding(horizontal = T.gutter, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.AutoMirrored.Filled.Logout, null, tint = T.danger, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(13.dp))
        Txt("Sign out", Type.rowName, T.danger, Modifier.weight(1f))
    }
}

/** Which part of the More tab a destination belongs to. Named Area, not Group: the patient register already uses Group for a run of rows under a heading. */
enum class Area { Tool, Admin, Account }

/**
 * One destination, and who may see it.
 *
 * [built] says whether this app has the screen yet. Anything not built is still
 * listed, marked "On the website", rather than quietly missing — a receptionist
 * who knows the clinic has a lab board and cannot find it on the phone assumes
 * the app is broken, not that it is unfinished.
 */
enum class Destination(
    val label: String,
    val caption: String,
    val icon: ImageVector,
    val area: Area,
    val built: Boolean = false,
    private val permission: String? = null,
) {
    Money("Money", "Takings, expenses and the day's ledger", Icons.Filled.Payments, Area.Tool, built = true, permission = "access.finance"),
    Reports("Reports", "How the clinic is doing", Icons.Filled.BarChart, Area.Tool, built = true, permission = "access.reports"),
    Lab("Lab", "Cases out at the laboratory", Icons.Filled.Science, Area.Tool, built = true, permission = "access.lab"),
    Ortho("Ortho", "Cases and adjustments", Icons.Filled.Timeline, Area.Tool, built = true, permission = "access.ortho"),
    Leads("Leads", "Enquiries from ads and calls", Icons.Filled.PersonSearch, Area.Tool, built = true, permission = "access.marketing"),
    Stock("Stock", "What is running out", Icons.Filled.Inventory2, Area.Tool, built = true, permission = "access.inventory"),
    Content("Content", "Write a post for the clinic's pages", Icons.Filled.Campaign, Area.Tool, built = true, permission = "access.marketing"),
    // No permission key of its own: each of its three answers is gated on the
    // screen it draws from, so an assistant sees the morning and nothing else.
    Assistant("Assistant", "The morning, who drifted off, money left behind", Icons.Filled.AutoAwesome, Area.Tool, built = true),
    // No permission key: everybody has a shift of their own, and clocking in
    // is not an admin act. The screen itself shows the clinic-wide half only
    // to whoever the website would show it to.
    Attendance("Attendance", "Your shift, and who is in", Icons.Filled.Groups, Area.Admin, built = true),
    Reminders("Auto SMS", "Reminders sent from a clinic phone", Icons.Filled.Sms, Area.Admin, built = true, permission = "access.settings"),
    Settings("Settings", "How the clinic runs", Icons.Filled.Settings, Area.Admin, built = true, permission = "access.settings"),
    // Built, and not a website thing: it flips the app's own language.
    Language("العربية", "Change the app's language", Icons.Filled.Language, Area.Account, built = true),
    ;

    /**
     * Whether to draw this at all.
     *
     * The granted key, never a guess from the role — an Assistant ticked for a
     * thing on the website should find it on the phone. This is a convenience,
     * not a security boundary: Firestore's rules are the boundary, and this only
     * decides whether to offer a door the server would slam.
     */
    fun allowed(who: Who?): Boolean {
        val key = permission ?: return true
        return who?.can(key) == true
    }
}
