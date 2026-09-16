package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.Invites
import com.alphadental.clinic.next.design.BrandMark
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class Join(
    val code: String = "",
    val checking: Boolean = false,
    val joining: Boolean = false,
    val peek: Invites.Peek? = null,
    val error: String? = null,
    val joined: String? = null,
) {
    /** Codes are eight characters once the dashes and spaces are gone. */
    val ready: Boolean get() = Invites.normalize(code).length >= 4 && !checking && !joining
}

/**
 * Joining a clinic with an invite code.
 *
 * Shown to somebody signed in whose account belongs to no clinic — which until
 * now was a dead end with a sentence in it. The website hands out a link; a new
 * hire who installs the app instead of opening the link has the code and
 * nowhere to put it.
 *
 * The code is looked up before it is used, so the screen can say whose clinic it
 * is and what role it grants before anybody commits. An invite that has expired
 * or been withdrawn says so plainly rather than failing at the last step.
 */
class JoinModel : ViewModel() {

    private val _state = MutableStateFlow(Join())
    val state: StateFlow<Join> = _state.asStateFlow()

    fun setCode(code: String) {
        _state.value = _state.value.copy(code = code, peek = null, error = null)
    }

    fun check() {
        val code = _state.value.code
        if (!_state.value.ready) return
        _state.value = _state.value.copy(checking = true, error = null, peek = null)
        viewModelScope.launch {
            Invites.peek(code)
                .onSuccess { _state.value = _state.value.copy(checking = false, peek = it) }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        checking = false,
                        error = e.message ?: "That code could not be checked.",
                    )
                }
        }
    }

    fun join() {
        val code = _state.value.code
        if (_state.value.joining) return
        _state.value = _state.value.copy(joining = true, error = null)
        viewModelScope.launch {
            Invites.accept(code)
                .onSuccess { name ->
                    _state.value = _state.value.copy(
                        joining = false,
                        joined = name.ifBlank { "the clinic" },
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        joining = false,
                        error = e.message ?: "That invite could not be used.",
                    )
                }
        }
    }
}

@Composable
fun JoinScreen(
    state: Join,
    onCode: (String) -> Unit,
    onCheck: () -> Unit,
    onJoin: () -> Unit,
    onRetry: () -> Unit,
    onSignOut: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(T.slab)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = T.gutter),
    ) {
        Spacer(Modifier.height(72.dp))
        BrandMark(size = 44)
        Spacer(Modifier.height(22.dp))

        if (state.joined != null) {
            Txt("You are in", Type.title, T.onSlab, maxLines = 2)
            Spacer(Modifier.height(8.dp))
            Txt(
                "This account now belongs to ${state.joined}.",
                Type.body, T.onSlabSoft, maxLines = 3,
            )
            Spacer(Modifier.height(26.dp))
            Pill("Open the clinic", solid = true, onClick = onRetry)
            return@Column
        }

        Txt("Join a clinic", Type.title, T.onSlab, maxLines = 2)
        Spacer(Modifier.height(8.dp))
        Txt(
            "You are signed in, but this account does not belong to a clinic yet. Type the " +
                "invite code the clinic sent you.",
            Type.body, T.onSlabSoft, maxLines = 4,
        )

        Spacer(Modifier.height(28.dp))

        JoinField(
            value = state.code,
            enabled = !state.joining,
            onChange = onCode,
            onDone = onCheck,
        )

        state.error?.let {
            Spacer(Modifier.height(14.dp))
            Txt(it, Type.body, T.danger, maxLines = 4)
        }

        state.peek?.let { peek ->
            Spacer(Modifier.height(18.dp))
            if (peek.usable) {
                Txt(
                    peek.clinicName.ifBlank { "A clinic" },
                    Type.heading, T.onSlab, maxLines = 2,
                )
                Spacer(Modifier.height(4.dp))
                Txt(
                    "You would join as ${peek.role}. What you can open is decided by the clinic " +
                        "afterwards.",
                    Type.caption, T.onSlabFaint, maxLines = 3,
                )
            } else {
                Txt(peek.problem, Type.body, T.danger, maxLines = 3)
                Spacer(Modifier.height(4.dp))
                Txt(
                    "Ask the clinic to send a new link.",
                    Type.caption, T.onSlabFaint, maxLines = 2,
                )
            }
        }

        Spacer(Modifier.height(26.dp))

        val peek = state.peek
        when {
            peek?.usable == true -> Pill(
                label = "Join ${peek.clinicName.ifBlank { "this clinic" }}",
                solid = true,
                busy = state.joining,
                onClick = onJoin,
            )
            else -> Pill(
                label = "Check the code",
                solid = state.ready,
                busy = state.checking,
                enabled = state.ready,
                onClick = onCheck,
            )
        }

        Spacer(Modifier.height(24.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Txt(
                "Already been added? Try again",
                Type.body, T.onSlabFaint,
                Modifier.clickable(onClick = onRetry),
            )
        }
        Spacer(Modifier.height(14.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Txt(
                "Sign out",
                Type.body, T.onSlabFaint,
                Modifier.clickable(onClick = onSignOut),
            )
        }
        Spacer(Modifier.height(40.dp))
    }
}

@Composable
private fun JoinField(
    value: String,
    enabled: Boolean,
    onChange: (String) -> Unit,
    onDone: () -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Txt("INVITE CODE", Type.eyebrow, T.onSlabFaint, uppercase = true)
        Spacer(Modifier.height(7.dp))
        androidx.compose.material3.OutlinedTextField(
            value = value,
            onValueChange = onChange,
            enabled = enabled,
            singleLine = true,
            placeholder = { Txt("ABCD-1234", Type.body, T.onSlabFaint) },
            shape = T.cardShape,
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                // Upper case, because every code is, and a phone that opens on
                // lower case makes somebody fight the keyboard for eight
                // characters.
                capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Characters,
                keyboardType = KeyboardType.Text,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { onDone() }),
            colors = androidx.compose.material3.TextFieldDefaults.colors(
                focusedContainerColor = T.slabFill,
                unfocusedContainerColor = T.slabFill,
                disabledContainerColor = T.slabFill,
                focusedTextColor = T.onSlab,
                unfocusedTextColor = T.onSlab,
                focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                disabledIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                cursorColor = T.accent,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun Pill(
    label: String,
    solid: Boolean,
    busy: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Surface(
        shape = T.pill,
        color = if (solid && enabled) T.accent else T.slabFill,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled && !busy, onClick = onClick),
    ) {
        Box(Modifier.padding(vertical = 15.dp), contentAlignment = Alignment.Center) {
            if (busy) {
                CircularProgressIndicator(
                    color = T.onSlabFaint, strokeWidth = 2.dp, modifier = Modifier.size(19.dp),
                )
            } else {
                Txt(
                    label,
                    Type.label.copy(fontSize = 14.sp),
                    if (solid && enabled) T.onAccent else T.onSlabFaint,
                    maxLines = 1,
                )
            }
        }
    }
}
