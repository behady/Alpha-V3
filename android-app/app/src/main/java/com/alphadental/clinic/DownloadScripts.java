package com.alphadental.clinic;

/**
 * JavaScript that is injected into every loaded page.
 *
 * <p>The clinic system builds PDFs and spreadsheets in the browser (jsPDF,
 * SheetJS) and hands them to the user as a "blob" link. A WebView has no
 * download folder of its own, so those links do nothing at all. This script
 * catches them before they vanish and passes the bytes to
 * {@link DownloadBridge}.
 */
final class DownloadScripts {

    private DownloadScripts() {
    }

    static final String INSTALL_DOWNLOAD_HOOK = """
            (function () {
              if (window.__alphaDownloadHook) { return; }
              var bridge = window.AlphaDownloader;
              if (!bridge) { return; }
              window.__alphaDownloadHook = true;

              var inFlight = Object.create(null);

              function isGeneratedFile(href) {
                return typeof href === 'string'
                  && (href.lastIndexOf('blob:', 0) === 0 || href.lastIndexOf('data:', 0) === 0);
              }

              // jsPDF and friends revoke the blob URL shortly after clicking it.
              // Hold the revoke back while we are still reading that URL.
              var revoke = URL.revokeObjectURL.bind(URL);
              URL.revokeObjectURL = function (url) {
                if (inFlight[url]) {
                  setTimeout(function () { try { revoke(url); } catch (e) {} }, 15000);
                  return;
                }
                return revoke(url);
              };

              function send(href, filename, mimeHint) {
                inFlight[href] = true;
                function done() { delete inFlight[href]; }

                fetch(href).then(function (response) {
                  return response.blob();
                }).then(function (blob) {
                  var id = bridge.begin(filename || '', blob.type || mimeHint || '');
                  if (!id) { done(); return; }

                  var reader = new FileReader();
                  reader.onload = function () {
                    try {
                      var text = String(reader.result);
                      var comma = text.indexOf(',');
                      var data = comma >= 0 ? text.substring(comma + 1) : '';
                      var step = bridge.chunkSize();
                      for (var i = 0; i < data.length; i += step) {
                        if (!bridge.write(id, data.substring(i, i + step))) { done(); return; }
                      }
                      bridge.finish(id);
                    } catch (err) {
                      bridge.cancel(id, String(err && err.message ? err.message : err));
                    }
                    done();
                  };
                  reader.onerror = function () {
                    bridge.cancel(id, 'The file could not be read.');
                    done();
                  };
                  reader.readAsDataURL(blob);
                }).catch(function (err) {
                  done();
                  bridge.cancel('', String(err && err.message ? err.message : err));
                });
              }

              // Downloads triggered from code, e.g. jsPDF's doc.save().
              var nativeClick = HTMLAnchorElement.prototype.click;
              HTMLAnchorElement.prototype.click = function () {
                try {
                  if (this.hasAttribute('download') && isGeneratedFile(this.href)) {
                    send(this.href, this.getAttribute('download'), this.type);
                    return;
                  }
                } catch (e) {}
                return nativeClick.apply(this, arguments);
              };

              // Downloads triggered by the user tapping a link.
              document.addEventListener('click', function (event) {
                var node = event.target;
                while (node && node.tagName !== 'A') { node = node.parentElement; }
                if (!node) { return; }
                if (node.hasAttribute('download') && isGeneratedFile(node.href)) {
                  event.preventDefault();
                  event.stopPropagation();
                  send(node.href, node.getAttribute('download'), node.type);
                }
              }, true);

              // Some libraries open the file in a new tab instead.
              var nativeOpen = window.open;
              window.open = function (url) {
                if (isGeneratedFile(url)) {
                  send(url, '', '');
                  return null;
                }
                return nativeOpen.apply(window, arguments);
              };
            })();
            """;

    /**
     * Reports the page's real scroll position, wherever it actually lives.
     *
     * <p>Scroll events do not bubble, but they can still be caught on the way
     * down, which is how one listener sees every scrolling box on the page.
     */
    static final String INSTALL_SCROLL_REPORTER = """
            (function () {
              if (window.__alphaScrollReporter) { return; }
              var bridge = window.AlphaPage;
              if (!bridge) { return; }
              window.__alphaScrollReporter = true;

              function report(target) {
                var top;
                if (!target || target === document || target === window
                    || target === document.documentElement || target === document.body) {
                  top = window.scrollY || document.documentElement.scrollTop || 0;
                } else {
                  top = target.scrollTop || 0;
                }
                bridge.setScrolledToTop(top <= 0);
              }

              document.addEventListener('scroll', function (event) {
                report(event.target);
              }, true);

              report(null);
            })();
            """;

    /**
     * Reports the page's own background colour so the status bar can match it,
     * including when the user flips the clinic system's dark mode switch.
     */
    static final String READ_PAGE_BACKGROUND = """
            (function () {
              var body = document.body;
              if (!body) { return ''; }
              var colour = getComputedStyle(body).backgroundColor;
              if (!colour || colour === 'transparent' || colour === 'rgba(0, 0, 0, 0)') {
                colour = getComputedStyle(document.documentElement).backgroundColor;
              }
              return colour || '';
            })();
            """;
}
