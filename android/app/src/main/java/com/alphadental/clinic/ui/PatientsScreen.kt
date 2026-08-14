package com.alphadental.clinic.ui

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
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
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
        Surface(color = Alpha.Ground, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text(
                    if (arabic) "المرضى" else "Patients",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Black,
                    color = Alpha.Slate900,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    label = { Text(if (arabic) "ابحث بالاسم أو رقم الهاتف" else "Search name or phone number") },
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
                    shape = Alpha.CardShape,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Alpha.Green,
                        unfocusedBorderColor = Alpha.Slate200,
                        focusedContainerColor = Color.White,
                        unfocusedContainerColor = Color.White,
                        focusedLabelColor = Alpha.Green,
                        unfocusedLabelColor = Alpha.Slate400,
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

        when {
            searching && results.isEmpty() -> Box(
                Modifier
                    .fillMaxSize()
                    .padding(32.dp),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }

            results.isEmpty() -> Box(
                Modifier
                    .fillMaxSize()
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

            else -> LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(results, key = { it.id }) { patient ->
                    AlphaCard(modifier = Modifier.fillMaxWidth(), shape = Alpha.CardShape) {
                        TextButton(
                            onClick = { onOpenPatient(patient) },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(
                                Icons.Filled.Person,
                                contentDescription = null,
                                tint = Alpha.Slate400,
                                modifier = Modifier.size(18.dp),
                            )
                            Spacer(Modifier.size(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    patient.name,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Black,
                                    color = Alpha.Slate900,
                                )
                                if (patient.phone.isNotBlank()) {
                                    Text(
                                        patient.phone,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = Alpha.Slate400,
                                    )
                                }
                            }
                        }
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
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Black,
                                color = Alpha.Green,
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
