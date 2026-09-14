package com.alphadental.clinic.next

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import androidx.lifecycle.HasDefaultViewModelProviderFactory
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import com.alphadental.clinic.BuildConfig
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.design.BrandMark
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
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

    /** Hand Firebase the token the phone's account picker produced. */
    fun submitGoogle(idToken: String) {
        _state.value = _state.value.copy(busy = true, error = null, sent = null)
        viewModelScope.launch {
            ClinicSource.signInWithGoogle(idToken)
                .onSuccess { _state.value = _state.value.copy(busy = false) }
                .onFailure { e ->
                    _state.value = _state.value.copy(busy = false, error = e.message ?: "Could not sign in.")
                }
        }
    }

    /** The account picker was closed, or it failed before any token existed. */
    fun googleFailed(message: String?) {
        _state.value = _state.value.copy(busy = false, error = message)
    }

    fun working() {
        _state.value = _state.value.copy(busy = true, error = null, sent = null)
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
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // Asks the phone for a Google account, then hands the ID token to Firebase.
    // Closing the sheet is a choice rather than a failure, so it says nothing —
    // an error panel for "changed my mind" is how a screen teaches people that
    // its errors are noise.
    val google: () -> Unit = {
        if (!state.busy) {
            scope.launch {
                model.working()
                try {
                    val request = GetCredentialRequest.Builder()
                        .addCredentialOption(
                            GetSignInWithGoogleOption.Builder(BuildConfig.FB_WEB_CLIENT_ID).build()
                        )
                        .build()
                    val credential = CredentialManager.create(context)
                        .getCredential(context, request).credential
                    if (credential is CustomCredential &&
                        credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                    ) {
                        model.submitGoogle(GoogleIdTokenCredential.createFrom(credential.data).idToken)
                    } else {
                        model.googleFailed("Google did not return a sign-in.")
                    }
                } catch (e: GetCredentialCancellationException) {
                    model.googleFailed(null)
                } catch (e: NoCredentialException) {
                    // Worth its own message. "Not available" sends somebody
                    // looking for a fault in the app; the actual problem is that
                    // this phone has no Google account on it, which they can fix
                    // in thirty seconds.
                    model.googleFailed(
                        "There is no Google account on this phone. Add one in Android's settings, " +
                            "or sign in with the email and password."
                    )
                } catch (e: Exception) {
                    // Credential Manager's own messages name classes and error
                    // codes. The one thing worth saying is what to do instead.
                    model.googleFailed(
                        "Google sign-in is not available on this phone. Use the email and password."
                    )
                }
            }
        }
    }

    SignInBody(state, model::setEmail, model::setPassword, model::submit, model::reset, google)
}

@Composable
fun SignInBody(
    state: SignIn,
    onEmail: (String) -> Unit,
    onPassword: (String) -> Unit,
    onSubmit: () -> Unit,
    onReset: () -> Unit,
    onGoogle: () -> Unit = {},
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

        Spacer(Modifier.height(26.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f).height(1.dp).background(T.slabLine))
            Txt("or", Type.caption, T.onSlabFaint, Modifier.padding(horizontal = 12.dp))
            Box(Modifier.weight(1f).height(1.dp).background(T.slabLine))
        }
        Spacer(Modifier.height(26.dp))

        // The same account as the website's Google button, resolved by Firebase
        // to the same uid — so whoever set the clinic up on a laptop signs in
        // here without anybody minting them a second password.
        Surface(
            shape = T.pill,
            color = T.slabFill,
            border = androidx.compose.foundation.BorderStroke(1.dp, T.slabLine),
            modifier = Modifier
                .fillMaxWidth()
                .clickable(enabled = !state.busy) { keyboard?.hide(); onGoogle() },
        ) {
            Row(
                Modifier.padding(vertical = 15.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                GoogleG()
                Spacer(Modifier.width(10.dp))
                Txt("Continue with Google", Type.label.copy(fontSize = 14.sp), T.onSlab)
            }
        }

        Spacer(Modifier.height(40.dp))
    }
}

/**
 * Google's G, drawn rather than shipped as an asset.
 *
 * Four arcs and a bar, in Google's own four colours, which their brand terms
 * require to be exact — a grey or monochrome G on a dark button is the version
 * that gets an app rejected.
 */
@Composable
private fun GoogleG() {
    androidx.compose.foundation.Canvas(Modifier.size(18.dp)) {
        val w = size.width
        val stroke = w * 0.22f
        val inset = stroke / 2f
        val rect = androidx.compose.ui.geometry.Size(w - stroke, w - stroke)
        val at = androidx.compose.ui.geometry.Offset(inset, inset)
        val style = androidx.compose.ui.graphics.drawscope.Stroke(width = stroke)
        // Starting at the right and going clockwise: red, yellow, green, blue.
        drawArc(androidx.compose.ui.graphics.Color(0xFFEA4335), -45f, -135f, false, at, rect, style = style)
        drawArc(androidx.compose.ui.graphics.Color(0xFFFBBC05), 180f, -45f, false, at, rect, style = style)
        drawArc(androidx.compose.ui.graphics.Color(0xFF34A853), 135f, -90f, false, at, rect, style = style)
        drawArc(androidx.compose.ui.graphics.Color(0xFF4285F4), 45f, -90f, false, at, rect, style = style)
        // The bar into the middle, which is what makes it a G and not an O.
        drawRect(
            color = androidx.compose.ui.graphics.Color(0xFF4285F4),
            topLeft = androidx.compose.ui.geometry.Offset(w * 0.5f, w * 0.39f),
            size = androidx.compose.ui.geometry.Size(w * 0.5f - inset, stroke),
        )
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
