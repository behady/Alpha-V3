package com.alphadental.clinic.ui

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.PersonSearch
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Patient
import kotlinx.coroutines.delay

/**
 * The patient directory: browse it, or search it.
 *
 * With the box empty this is the whole register in name order, a page at a time — a clinic often
 * wants to look through patients rather than already know the name. Typing filters it, from the
 * first character, using the same matching rules as the website so the two never disagree about
 * who exists.
 */
@Composable
fun PatientsScreen(
    results: List<Patient>,
    searching: Boolean,
    loadingMore: Boolean,
    hasMore: Boolean,
    offline: Boolean,
    arabic: Boolean,
    onSearch: (String) -> Unit,
    onLoadMore: () -> Unit,
    onOpenPatient: (Patient) -> Unit,
    /** The last read failed; shown over whatever names are already there. */
    error: String? = null,
    onRefresh: () -> Unit = {},
) {
    var query by remember { mutableStateOf("") }

    // Fires on every change including back to empty, so clearing the box returns to the full
    // directory rather than leaving the last search stranded on screen. One character is enough —
    // that is what the website accepts, and a receptionist typing "m" expects to see the Ms.
    LaunchedEffect(query) {
        delay(300)
        onSearch(query)
    }

    Column(Modifier.fillMaxSize()) {
        // The directory is a screen with something to state — how many people the
        // clinic has on its books — so it gets a slab like every other screen,
        // rather than a heading floating on the ground.
        Slab(
            title = if (arabic) "المرضى" else "Patients",
            subtitle = directoryCount(results.size, hasMore, arabic),
        )

        // The search box sits on white directly under the slab, where it reads as
        // the top of the list rather than as a control stranded on the ground.
        Surface(color = Alpha.Card, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = {
                        Text(
                            if (arabic) "ابحث بالاسم أو رقم الهاتف" else "Search name or phone number",
                            color = Alpha.Slate400,
                        )
                    },
                    singleLine = true,
                    leadingIcon = { Icon(Icons.Filled.Search, null, tint = Alpha.Slate400) },
                    trailingIcon = {
                        if (searching) {
                            CircularProgressIndicator(
                                strokeWidth = 2.dp,
                                color = Alpha.Slate400,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    },
                    shape = Alpha.PillShape,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Alpha.Slate900,
                        unfocusedBorderColor = Alpha.Line,
                        focusedContainerColor = Alpha.Slate50,
                        unfocusedContainerColor = Alpha.Slate50,
                        cursorColor = Alpha.Ink,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )

                // Offline search only sees patients this phone has already downloaded. Saying so
                // stops "not found" being read as "not a patient here".
                if (offline) {
                    Spacer(Modifier.height(10.dp))
                    OfflineBanner(pending = 0, arabic = arabic)
                }
            }
        }

        RefreshBox(
            refreshing = searching && results.isNotEmpty(),
            onRefresh = onRefresh,
            modifier = Modifier.weight(1f),
        ) {
            Column(Modifier.fillMaxSize()) {
                error?.let {
                    LoadErrorBanner(it, arabic, onRefresh, Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp))
                }
                Box(Modifier.weight(1f)) {
                    when {
                        searching && results.isEmpty() -> Box(
                            Modifier
                                .fillMaxSize()
                                .padding(32.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
                        }

                        // Scrollable even though it holds one message, or the pull-down would have nothing
                        // to take hold of on exactly the screen most likely to need it.
                        results.isEmpty() -> Box(
                            Modifier
                                .fillMaxSize()
                                .verticalScroll(rememberScrollState())
                                .padding(32.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(
                                    Icons.Filled.PersonSearch,
                                    contentDescription = null,
                                    tint = Alpha.Slate300,
                                    modifier = Modifier.size(44.dp),
                                )
                                Spacer(Modifier.height(12.dp))
                                Text(
                                    if (query.isBlank()) {
                                        if (arabic) "لا يوجد مرضى في السجل بعد." else "No patients in the directory yet."
                                    } else {
                                        if (arabic) "لا يوجد مريض بهذا الاسم أو الرقم."
                                        else "No patient matches that name or number."
                                    },
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Alpha.Slate400,
                                )
                            }
                        }

                        // Full-bleed: the register is one ruled white surface
                        // running edge to edge, the way a contacts list is.
                        else -> LazyColumn(
                            contentPadding = PaddingValues(bottom = 24.dp),
                        ) {
                            items(results, key = { it.id }) { patient ->
                                Column(Modifier.background(Alpha.Card)) {
                                    AlphaRow(
                                        title = patient.name,
                                        subtitle = patient.phone.takeIf { it.isNotBlank() },
                                        onClick = { onOpenPatient(patient) },
                                        leading = { PatientInitial(patient.name) },
                                        trailing = {
                                            Icon(
                                                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                                                contentDescription = null,
                                                tint = Alpha.Slate300,
                                                modifier = Modifier.size(20.dp),
                                            )
                                        },
                                    )
                                    RowHairline()
                                }
                            }

                            item {
                                when {
                                    loadingMore -> Box(
                                        Modifier
                                            .fillMaxWidth()
                                            .padding(vertical = 16.dp),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        CircularProgressIndicator(
                                            color = Alpha.Slate400,
                                            strokeWidth = 2.dp,
                                            modifier = Modifier.size(22.dp),
                                        )
                                    }

                                    hasMore -> TextButton(
                                        onClick = onLoadMore,
                                        modifier = Modifier.fillMaxWidth(),
                                    ) {
                                        Text(
                                            if (arabic) "تحميل المزيد" else "Load more",
                                            fontFamily = AlphaType.Display,
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = Alpha.AccentInk,
                                        )
                                    }

                                    // The end of a directory is worth stating. Otherwise a list that simply
                                    // stops looks like it is still loading.
                                    else -> Text(
                                        text = if (arabic) "${results.size} مريض" else "${results.size} patient${if (results.size == 1) "" else "s"}",
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Alpha.Slate400,
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(vertical = 16.dp),
                                        textAlign = TextAlign.Center,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}


/**
 * A patient's initial.
 *
 * Achromatic on purpose. It used to be the success green, which put a colour
 * that means "paid" beside every name in the register — colour in this app marks
 * something to act on, and a person existing is not something to act on.
 */
@Composable
private fun PatientInitial(name: String) {
    Box(
        modifier = Modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(Alpha.Slate100),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = name.trim().firstOrNull()?.uppercase() ?: "\u2022",
            fontFamily = AlphaType.Display,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            color = Alpha.Slate600,
        )
    }
}

/** "1,482 records" under the title — with a + while more pages are still unread. */
private fun directoryCount(shown: Int, hasMore: Boolean, arabic: Boolean): String {
    val n = if (hasMore) "$shown+" else shown.toString()
    return if (arabic) "$n سجل" else "$n record" + if (shown == 1 && !hasMore) "" else "s"
}
