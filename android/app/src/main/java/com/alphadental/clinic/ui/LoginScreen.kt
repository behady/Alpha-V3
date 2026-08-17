package com.alphadental.clinic.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import com.alphadental.clinic.BuildConfig
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.launch

/**
 * Sign in.
 *
 * Email and password, or Google. The Google path goes through Android's
 * Credential Manager — the same account sheet the rest of the phone uses — and
 * hands Firebase the resulting ID token. It resolves to the same account the
 * website's Google sign-in resolves to, because both talk to the same project;
 * this only became possible once the release signing certificate was registered
 * on the Firebase Android app (done 2026-08-17).
 */
@Composable
fun LoginScreen(
    signingIn: Boolean,
    error: String?,
    onSignIn: (String, String) -> Unit,
    onGoogleToken: (String) -> Unit,
) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }

    val submit = { if (!signingIn) onSignIn(email, password) }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var googleBusy by remember { mutableStateOf(false) }
    var googleError by remember { mutableStateOf<String?>(null) }

    // Asks the phone's Credential Manager for a Google account, then hands the
    // ID token up. Cancelling the sheet is a choice, not an error, so it says
    // nothing; everything else surfaces in the same error panel as a bad password.
    val startGoogle: () -> Unit = {
        if (!googleBusy && !signingIn) {
            scope.launch {
                googleBusy = true
                googleError = null
                try {
                    val manager = CredentialManager.create(context)
                    val option = GetSignInWithGoogleOption
                        .Builder(BuildConfig.FB_WEB_CLIENT_ID)
                        .build()
                    val request = GetCredentialRequest.Builder()
                        .addCredentialOption(option)
                        .build()
                    val credential = manager.getCredential(context, request).credential
                    if (credential is CustomCredential &&
                        credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                    ) {
                        onGoogleToken(GoogleIdTokenCredential.createFrom(credential.data).idToken)
                    } else {
                        googleError = "Google did not return a sign-in."
                    }
                } catch (e: GetCredentialCancellationException) {
                    // The person closed the sheet.
                } catch (e: Exception) {
                    googleError = e.message ?: "Google sign-in failed."
                } finally {
                    googleBusy = false
                }
            }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Alpha.Ground)
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Spacer(Modifier.height(48.dp))

            // The website's black rounded badge with the sparkle mark.
            Surface(
                shape = Alpha.CardShape,
                color = Alpha.Ink,
                modifier = Modifier.size(60.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text("✦", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
                }
            }

            Spacer(Modifier.height(20.dp))
            Text(
                "Welcome to Alpha",
                fontSize = 26.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Alpha.Slate900,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "Sign in to access your clinic system",
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                color = Alpha.Slate500,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(28.dp))

            AlphaCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp)) {
                    OutlinedTextField(
                        value = email,
                        onValueChange = { email = it },
                        label = { Text("Email address") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Email,
                            imeAction = ImeAction.Next,
                        ),
                        shape = Alpha.CardShape,
                        colors = alphaFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Spacer(Modifier.height(12.dp))

                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("Password") },
                        singleLine = true,
                        visualTransformation = if (showPassword) VisualTransformation.None
                        else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            imeAction = ImeAction.Done,
                        ),
                        keyboardActions = KeyboardActions(onDone = { submit() }),
                        trailingIcon = {
                            IconButton(onClick = { showPassword = !showPassword }) {
                                Icon(
                                    if (showPassword) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                                    contentDescription = if (showPassword) "Hide password" else "Show password",
                                    tint = Alpha.Slate400,
                                )
                            }
                        },
                        shape = Alpha.CardShape,
                        colors = alphaFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    val shownError = error ?: googleError
                    if (shownError != null) {
                        Spacer(Modifier.height(12.dp))
                        Surface(shape = Alpha.CardShape, color = Alpha.DangerSoft, modifier = Modifier.fillMaxWidth()) {
                            Text(
                                shownError,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.DangerText,
                                modifier = Modifier.padding(12.dp),
                            )
                        }
                    }

                    Spacer(Modifier.height(18.dp))

                    Button(
                        onClick = submit,
                        enabled = !signingIn,
                        shape = Alpha.CardShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Alpha.Ink,
                            contentColor = Color.White,
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp),
                    ) {
                        if (signingIn) {
                            CircularProgressIndicator(
                                color = Color.White,
                                strokeWidth = 2.dp,
                                modifier = Modifier.size(20.dp),
                            )
                        } else {
                            Text("Sign In", fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
                        }
                    }

                    // "or" divider
                    Spacer(Modifier.height(14.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.weight(1f).height(1.dp).background(Alpha.Slate200))
                        Text(
                            "or",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Alpha.Slate400,
                            modifier = Modifier.padding(horizontal = 10.dp),
                        )
                        Box(Modifier.weight(1f).height(1.dp).background(Alpha.Slate200))
                    }
                    Spacer(Modifier.height(14.dp))

                    OutlinedButton(
                        onClick = startGoogle,
                        enabled = !signingIn && !googleBusy,
                        shape = Alpha.CardShape,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp),
                    ) {
                        if (googleBusy) {
                            CircularProgressIndicator(
                                color = Alpha.Slate400,
                                strokeWidth = 2.dp,
                                modifier = Modifier.size(20.dp),
                            )
                        } else {
                            Text(
                                "G",
                                fontSize = 17.sp,
                                fontWeight = FontWeight.ExtraBold,
                                color = Color(0xFF4285F4),
                            )
                            Spacer(Modifier.size(9.dp))
                            Text(
                                "Continue with Google",
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Slate800,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(48.dp))
        }
    }
}

@Composable
private fun alphaFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Alpha.Green,
    unfocusedBorderColor = Alpha.Slate200,
    focusedContainerColor = Alpha.Card,
    unfocusedContainerColor = Alpha.Slate50,
    focusedLabelColor = Alpha.Green,
    unfocusedLabelColor = Alpha.Slate400,
    cursorColor = Alpha.Ink,
)
