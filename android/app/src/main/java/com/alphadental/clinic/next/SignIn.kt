package com.alphadental.clinic.next

import android.app.Application
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.HasDefaultViewModelProviderFactory
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.design.BrandMark
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The door.
 *
 * Which of the two things the app is — a sign-in screen or the clinic — is
 * decided by Firebase Auth and nothing else, watched rather than read once. Read
 * once, signing out would leave somebody sitting in a shell whose every query
 * now fails, which is exactly what it did before this existed.
 *
 * Signing out also has to forget the last person. View models live on the
 * activity by default, so the dashboard, the patient list and the settings a
 * receptionist had open would still be in memory when the next person signs in —
 * showing one account's clinic to another. Each session therefore gets its own
 * store, thrown away with the session.
 */
@Composable
fun Gate(preview: Boolean) {
    // Preview draws example data and has no account to sign in to.
    if (preview) {
        Shell(true)
        return
    }

    val auth = remember { FirebaseAuth.getInstance() }
    var uid by remember { mutableStateOf(auth.currentUser?.uid) }
    DisposableEffect(auth) {
        val listener = FirebaseAuth.AuthStateListener { uid = it.currentUser?.uid }
        auth.addAuthStateListener(listener)
        onDispose { auth.removeAuthStateListener(listener) }
    }

    if (uid == null) {
        SignInScreen()
        return
    }

    val app = LocalContext.current.applicationContext as Application
    val owner = remember(uid) { SessionOwner(app) }
    DisposableEffect(owner) { onDispose { owner.viewModelStore.clear() } }

    androidx.compose.runtime.CompositionLocalProvider(LocalViewModelStoreOwner provides owner) {
        Shell(false)
    }
}

/**
 * A view-model store that belongs to one signed-in session.
 *
 * It carries the default factory as well as the store: [SmsModel] is an
 * `AndroidViewModel` and cannot be built without an Application, which a bare
 * `ViewModelStoreOwner` does not supply.
 */
private class SessionOwner(app: Application) : ViewModelStoreOwner, HasDefaultViewModelProviderFactory {
    override val viewModelStore = ViewModelStore()
    override val defaultViewModelProviderFactory: ViewModelProvider.Factory =
        ViewModelProvider.AndroidViewModelFactory.getInstance(app)
}

// ---------------------------------------------------------------------------

data class SignIn(
    val email: String = "",
    val password: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    /** Set after a reset email goes out, so the screen can say so. */
    val sent: String? = null,
)

class SignInModel : ViewModel() {

    private val _state = MutableStateFlow(SignIn())
    val state: StateFlow<SignIn> = _state.asStateFlow()

    fun setEmail(value: String) {
        _state.value = _state.value.copy(email = value, error = null, sent = null)
    }

    fun setPassword(value: String) {
        _state.value = _state.value.copy(password = value, error = null, sent = null)
    }

    fun submit() {
        val s = _state.value
        if (s.busy || s.email.isBlank() || s.password.isBlank()) return
        _state.value = s.copy(busy = true, error = null, sent = null)
        viewModelScope.launch {
            ClinicSource.signIn(s.email, s.password)
                // Nothing on success: the auth listener in Gate is what swaps the
                // screen, so there is no second source of truth about being in.
                .onSuccess { _state.value = _state.value.copy(busy = false, password = "") }
                .onFailure { e ->
                    _state.value = _state.value.copy(busy = false, error = e.message ?: "Could not sign in.")
                }
        }
    }

    fun reset() {
        val s = _state.value
        if (s.busy) return
        if (s.email.isBlank()) {
            _state.value = s.copy(error = "Type the email address first.")
            return
        }
        _state.value = s.copy(busy = true, error = null, sent = null)
        viewModelScope.launch {
            ClinicSource.sendReset(s.email)
                .onSuccess {
                    _state.value = _state.value.copy(
                        busy = false,
                        sent = "A reset link is on its way to ${s.email.trim()}.",
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(busy = false, error = e.message)
                }
        }
    }
}

/**
 * Sign in.
 *
 * The same near-black ground the rest of the app opens on, so the first screen
 * of the app looks like the app. One decision on it and nothing else: there is
 * no sign-up, because an account is created by a clinic letting somebody in, not
 * by somebody arriving.
 */
@Composable
fun SignInScreen() {
    val model: SignInModel = viewModel()
    val state by model.state.collectAsState()
    SignInBody(state, model::setEmail, model::setPassword, model::submit, model::reset)
}

@Composable
fun SignInBody(
    state: SignIn,
    onEmail: (String) -> Unit,
    onPassword: (String) -> Unit,
    onSubmit: () -> Unit,
    onReset: () -> Unit,
) {
    var shown by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current

    Column(
        Modifier
            .fillMaxSize()
            .background(T.slab)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = T.gutter),
        horizontalAlignment = Alignment.Start,
    ) {
        Spacer(Modifier.height(72.dp))
        BrandMark(size = 44)
        Spacer(Modifier.height(22.dp))
        Txt("Alpha Dental", Type.title, T.onSlab)
        Spacer(Modifier.height(6.dp))
        Txt(
            "Sign in with the account the clinic gave you.",
            Type.body, T.onSlabSoft, maxLines = 2,
        )

        Spacer(Modifier.height(30.dp))

        DarkField(
            label = "Email",
            value = state.email,
            onChange = onEmail,
            enabled = !state.busy,
            keyboard = KeyboardType.Email,
            ime = ImeAction.Next,
        )
        Spacer(Modifier.height(14.dp))
        DarkField(
            label = "Password",
            value = state.password,
            onChange = onPassword,
            enabled = !state.busy,
            keyboard = KeyboardType.Password,
            ime = ImeAction.Done,
            onDone = { keyboard?.hide(); onSubmit() },
            hidden = !shown,
            trailing = {
                IconButton(onClick = { shown = !shown }) {
                    Icon(
                        if (shown) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                        contentDescription = if (shown) "Hide the password" else "Show the password",
                        tint = T.onSlabFaint,
                        modifier = Modifier.size(20.dp),
                    )
                }
            },
        )

        state.error?.let {
            Spacer(Modifier.height(14.dp))
            Txt(it, Type.body, T.danger, maxLines = 3)
        }
        state.sent?.let {
            Spacer(Modifier.height(14.dp))
            Txt(it, Type.body, T.accentInk, maxLines = 3)
        }

        Spacer(Modifier.height(24.dp))

        val ready = state.email.isNotBlank() && state.password.isNotBlank() && !state.busy
        Surface(
            shape = T.pill,
            color = if (ready) T.accent else T.slabFill,
            modifier = Modifier
                .fillMaxWidth()
                .clickable(enabled = ready) { keyboard?.hide(); onSubmit() },
        ) {
            Box(Modifier.padding(vertical = 15.dp), contentAlignment = Alignment.Center) {
                if (state.busy) {
                    CircularProgressIndicator(
                        color = T.onSlabFaint, strokeWidth = 2.dp,
                        modifier = Modifier.size(19.dp),
                    )
                } else {
                    Txt(
                        "Sign in",
                        Type.label.copy(fontSize = 14.sp),
                        if (ready) T.onAccent else T.onSlabFaint,
                    )
                }
            }
        }

        Spacer(Modifier.height(16.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Txt(
                "Forgotten the password?",
                Type.body, T.onSlabFaint,
                Modifier.clickable(enabled = !state.busy) { onReset() },
            )
        }

        Spacer(Modifier.height(40.dp))
        Txt(
            // Said rather than left as an absence: somebody who signs in to the
            // website with Google will look for that button here.
            "Google sign-in is on the website only for now.",
            Type.caption, T.onSlabFaint, maxLines = 2,
        )
        Spacer(Modifier.height(40.dp))
    }
}

/** A field on the slab. The palette's ink colours are for pale ground, not this. */
@Composable
private fun DarkField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    enabled: Boolean,
    keyboard: KeyboardType,
    ime: ImeAction,
    onDone: () -> Unit = {},
    hidden: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
) {
    Column(Modifier.fillMaxWidth()) {
        Txt(label, Type.eyebrow, T.onSlabFaint, uppercase = true)
        Spacer(Modifier.height(7.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            enabled = enabled,
            singleLine = true,
            visualTransformation = if (hidden) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = keyboard, imeAction = ime),
            keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { onDone() }),
            trailingIcon = trailing,
            shape = T.cardShape,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = T.slabFill,
                unfocusedContainerColor = T.slabFill,
                disabledContainerColor = T.slabFill,
                focusedTextColor = T.onSlab,
                unfocusedTextColor = T.onSlab,
                disabledTextColor = T.onSlabSoft,
                focusedIndicatorColor = T.accent,
                unfocusedIndicatorColor = T.slabLine,
                disabledIndicatorColor = T.slabLine,
                cursorColor = T.accent,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** The sign-in screen with example text in it, for checking the layout. */
fun previewSignIn(): SignIn = SignIn(email = "ahmed@alphadental.app", password = "secret")
