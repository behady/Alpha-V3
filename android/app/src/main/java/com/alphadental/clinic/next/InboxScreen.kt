package com.alphadental.clinic.next

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.alphadental.clinic.next.data.Notifications
import com.alphadental.clinic.next.design.Chip
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.Slab
import com.alphadental.clinic.next.design.SlabIcon
import com.alphadental.clinic.next.design.Stat
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/**
 * The bell's list.
 *
 * Newest first, an unread dot on the left, one word for the kind on the right. Tapping a row goes
 * where the alert points when the phone has that screen; hiding a row is a tap on "Hide". Opening
 * the list marks it read, so the badge means "not looked at", the way the website's bell does.
 */
@Composable
fun InboxScreen(
    state: AlertInbox,
    onBack: () -> Unit,
    onOpen: (Notifications.Alert) -> Unit,
    onDismiss: (String) -> Unit,
    onDismissAll: () -> Unit,
    onSeen: () -> Unit,
) {
    // Seen once the rows are on screen. Keyed on the count so a row arriving while the list is
    // open is marked too, without a loop on every recomposition.
    LaunchedEffect(state.visible.size, state.loading) { if (!state.loading) onSeen() }

    Column(Modifier.fillMaxSize().background(T.ground)) {
        Slab(
            title = "Alerts",
            eyebrow = when {
                state.loading -> "Everything addressed to you"
                state.unread > 0 -> "${state.unread} new"
                state.visible.isEmpty() -> "Nothing waiting"
                else -> "All read"
            },
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
            },
            stats = if (state.loading || state.error != null) emptyList() else listOf(
                Stat("New", state.unread.toString()),
                Stat("On the list", state.visible.size.toString()),
            ),
        )

        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }
            state.error != null -> Box(Modifier.fillMaxSize().padding(T.gutter), contentAlignment = Alignment.Center) {
                Txt(state.error, Type.body, T.inkFaint, maxLines = 4)
            }
            state.visible.isEmpty() -> Box(Modifier.fillMaxSize().padding(T.gutter), contentAlignment = Alignment.Center) {
                Txt("Nothing needs you. Alerts the clinic switches on under Settings → Alerts land here.", Type.body, T.inkFaint, maxLines = 3)
            }
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = T.barClearance)) {
                item {
                    Row(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 10.dp), horizontalArrangement = Arrangement.End) {
                        SettingsPill("Hide all") { onDismissAll() }
                    }
                }
                item {
                    RowGroup {
                        state.visible.forEachIndexed { i, a ->
                            if (i > 0) Rule()
                            AlertRow(a, state.isUnread(a), onOpen = { onOpen(a) }, onDismiss = { onDismiss(a.id) })
                        }
                    }
                }
                item {
                    Txt(
                        "Which alerts reach you, and how, is set on the website under Settings → Alerts. Hiding a row hides it for you only.",
                        Type.caption, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 12.dp), maxLines = 3,
                    )
                }
            }
        }
    }
}

@Composable
private fun AlertRow(a: Notifications.Alert, unread: Boolean, onOpen: () -> Unit, onDismiss: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(start = 14.dp, end = T.gutter, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.padding(top = 6.dp).size(8.dp).background(if (unread) T.accent else androidx.compose.ui.graphics.Color.Transparent, CircleShape))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Txt(a.title.ifBlank { "Alert" }, if (unread) Type.rowName else Type.body, T.ink, maxLines = 2)
            if (a.body.isNotBlank()) {
                Spacer(Modifier.height(2.dp))
                Txt(a.body, Type.caption, T.inkMuted, maxLines = 3)
            }
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Txt(ago(a.createdAtMillis), Type.chip, T.inkFaint, uppercase = true)
                if (a.group.isNotBlank()) {
                    Spacer(Modifier.width(8.dp))
                    Chip(groupLabel(a.group), T.surfaceSoft, T.inkMuted)
                }
                Spacer(Modifier.weight(1f))
                Txt("Hide", Type.chip, T.inkFaint, Modifier.clickable(onClick = onDismiss).padding(4.dp), uppercase = true)
            }
        }
    }
}

private fun groupLabel(group: String) = when (group) {
    "unanswered" -> "Unanswered"
    "frontdesk" -> "Front desk"
    "leads" -> "Leads"
    "reports" -> "Reports"
    "money" -> "Money"
    "clinic" -> "Clinic"
    "delivery" -> "Delivery"
    else -> group.replaceFirstChar { it.uppercase() }
}

private fun ago(millis: Long): String {
    if (millis <= 0L) return ""
    val minutes = ((System.currentTimeMillis() - millis) / 60_000L).coerceAtLeast(0)
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "$minutes min ago"
        minutes < 60 * 24 -> "${minutes / 60} h ago"
        else -> "${minutes / (60 * 24)} d ago"
    }
}
