package com.alphadental.clinic.next.data

import android.util.Log
import com.alphadental.clinic.Firebase
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.Query
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

/**
 * The bell — the phone's copy of the website's NotificationBell.
 *
 * Every alert the clinic raises is written once to `clinics/{id}/notifications` by the server
 * (never by a phone), and each row names its audience. The query is "audience contains me", so a
 * receptionist never sees the owner's evening money line even though both live in one clinic-wide
 * collection. Read and dismissed are per person, added with arrayUnion so two people opening the
 * bell at the same moment cannot erase each other's mark — and the rules let a phone change
 * exactly those two fields and nothing else.
 */
object Notifications {

    private const val TAG = "Notifications"

    data class Alert(
        val id: String,
        val title: String,
        val body: String,
        val eventType: String,
        /** unanswered · frontdesk · leads · reports · money · clinic · delivery */
        val group: String,
        /** The website's path, e.g. `/patients/abc` or `/lab`; the shell turns it into a screen. */
        val actionUrl: String,
        val readBy: List<String>,
        val dismissedBy: List<String>,
        val createdAtMillis: Long,
    ) {
        fun unreadFor(uid: String) = uid !in readBy
        fun visibleTo(uid: String) = uid !in dismissedBy
    }

    private fun collection(clinicId: String) =
        Firebase.db().collection("clinics").document(clinicId).collection("notifications")

    private fun DocumentSnapshot.strings(field: String): List<String> =
        (get(field) as? List<*>)?.mapNotNull { it?.toString() }.orEmpty()

    private fun DocumentSnapshot.toAlert() = Alert(
        id = id,
        title = getString("title").orEmpty(),
        body = getString("body").orEmpty(),
        eventType = getString("eventType").orEmpty(),
        group = getString("group").orEmpty(),
        actionUrl = getString("actionUrl").orEmpty(),
        readBy = strings("readBy"),
        dismissedBy = strings("dismissedBy"),
        createdAtMillis = getTimestamp("createdAt")?.toDate()?.time ?: 0L,
    )

    /**
     * Mine, newest first, live. Rows written before the catalogue existed carry no audience and
     * are not returned — nobody can say who they were for.
     *
     * Needs the composite index the website's bell uses (audience CONTAINS + createdAt DESC).
     * Until it exists the query fails and the screen says so, rather than sitting on an empty list.
     */
    fun observeMine(clinicId: String, uid: String): Flow<Result<List<Alert>>> = callbackFlow {
        val registration = collection(clinicId)
            .whereArrayContains("audience", uid)
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(40)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.w(TAG, "notifications failed: ${error.message}")
                    trySend(Result.failure(error))
                    return@addSnapshotListener
                }
                if (snapshot == null) return@addSnapshotListener
                trySend(Result.success(snapshot.documents.map { it.toAlert() }))
            }
        awaitClose { registration.remove() }
    }

    suspend fun markRead(clinicId: String, uid: String, ids: List<String>): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            if (ids.isEmpty()) return@runCatching
            val batch = Firebase.db().batch()
            ids.forEach { batch.update(collection(clinicId).document(it), "readBy", FieldValue.arrayUnion(uid)) }
            batch.commit().await()
            Unit
        }
    }

    /** Hidden for me and nobody else: a shared row cannot be deleted by one reader. */
    suspend fun dismiss(clinicId: String, uid: String, ids: List<String>): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            if (ids.isEmpty()) return@runCatching
            val batch = Firebase.db().batch()
            ids.forEach {
                batch.update(
                    collection(clinicId).document(it),
                    mapOf("dismissedBy" to FieldValue.arrayUnion(uid), "readBy" to FieldValue.arrayUnion(uid)),
                )
            }
            batch.commit().await()
            Unit
        }
    }
}
