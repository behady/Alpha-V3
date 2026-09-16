package com.alphadental.clinic.next

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** One help article, as its file says it is. */
data class Article(
    val slug: String,
    val title: String,
    val summary: String,
    val section: String,
    val order: Int,
    val roles: String,
    val body: String,
)

/**
 * The sections, in reading order.
 *
 * Mirrors HELP_SECTIONS in src/lib/helpSections.ts. The ids are the contract —
 * they are written into the frontmatter of every article — so a section renamed
 * here and not there simply stops matching and its articles vanish.
 */
val HELP_SECTIONS = listOf(
    "setup" to "Setting up your clinic",
    "frontdesk" to "Front desk",
    "money" to "Money",
    "clinical" to "Clinical",
    "operations" to "Running the clinic",
    "ai" to "AI features",
    "settings" to "Settings",
    "troubleshooting" to "When something looks wrong",
)

data class Help(
    val loading: Boolean = true,
    val articles: List<Article> = emptyList(),
    val query: String = "",
    val open: Article? = null,
    val error: String? = null,
) {
    val matches: List<Article>
        get() {
            val q = query.trim().lowercase()
            if (q.isEmpty()) return articles
            return articles.filter {
                it.title.lowercase().contains(q) ||
                    it.summary.lowercase().contains(q) ||
                    it.body.lowercase().contains(q)
            }
        }

    /** What is shown, grouped and in the order the articles are meant to be read. */
    val sections: List<Pair<String, List<Article>>>
        get() = HELP_SECTIONS.mapNotNull { (id, title) ->
            val rows = matches.filter { it.section == id }.sortedBy { it.order }
            if (rows.isEmpty()) null else title to rows
        }
}

/**
 * The help centre, read off the phone.
 *
 * The articles are the website's own files, copied into assets at build time
 * rather than rewritten — one set of words, corrected in one place. They are
 * read from disk, so this works with no signal, which is worth something for
 * the screen somebody opens when nothing else is working.
 *
 * Their screenshots are of the website and stay on the website: they load over
 * the network and are simply absent without it, which is the right way round —
 * the words are the help, the pictures are the illustration.
 */
class HelpModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow(Help())
    val state: StateFlow<Help> = _state.asStateFlow()

    fun start() {
        if (_state.value.articles.isNotEmpty()) return
        viewModelScope.launch {
            val rows = withContext(Dispatchers.IO) { read() }
            _state.value = _state.value.copy(
                loading = false,
                articles = rows,
                error = if (rows.isEmpty()) "The help articles are missing from this build." else null,
            )
        }
    }

    fun search(term: String) {
        _state.value = _state.value.copy(query = term)
    }

    fun open(article: Article?) {
        _state.value = _state.value.copy(open = article)
    }

    private fun read(): List<Article> {
        val assets = getApplication<Application>().assets
        // English only for now. The Arabic set is copied in beside it and the
        // app's language switch is the thing that has to choose between them;
        // shipping the files first means that switch is a one-line change
        // rather than a content project.
        val names = runCatching { assets.list("help/en").orEmpty() }.getOrDefault(emptyArray())
        return names.filter { it.endsWith(".md") }.mapNotNull { file ->
            val text = runCatching {
                assets.open("help/en/$file").bufferedReader().use { it.readText() }
            }.getOrNull() ?: return@mapNotNull null
            parse(file.removeSuffix(".md"), text)
        }
    }

    /**
     * Frontmatter, then the body.
     *
     * Deliberately small: these are our own files in a shape we control, so a
     * YAML library would be several hundred kilobytes to read eight keys. An
     * article missing its fences is skipped rather than shown with "---" as its
     * first line.
     */
    private fun parse(slug: String, raw: String): Article? {
        val text = raw.replace("\r\n", "\n")
        if (!text.startsWith("---")) return null
        val end = text.indexOf("\n---", 3)
        if (end < 0) return null

        val head = text.substring(3, end).trim().lines()
        val body = text.substring(end + 4).trim()

        fun field(key: String): String = head
            .firstOrNull { it.trimStart().startsWith("$key:") }
            ?.substringAfter(':')
            ?.trim()
            ?.trim('"')
            .orEmpty()

        return Article(
            slug = slug,
            title = field("title").ifBlank { slug.replace('-', ' ') },
            summary = field("summary"),
            section = field("section").ifBlank { "troubleshooting" },
            order = field("order").toIntOrNull() ?: 99,
            roles = field("roles"),
            body = body,
        )
    }
}
