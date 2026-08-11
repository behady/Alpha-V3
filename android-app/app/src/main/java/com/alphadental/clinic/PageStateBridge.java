package com.alphadental.clinic;

import android.webkit.JavascriptInterface;

/**
 * Lets the page tell the app whether it is scrolled to the top.
 *
 * <p>Why this is needed: on a phone the clinic dashboard scrolls inside a
 * {@code <div>}, not the page itself. Android therefore always believes the
 * view is at the top, and pull-to-refresh would fire in the middle of someone
 * scrolling back up a patient list. The page reports its own scroll position
 * instead, and {@link MainActivity} only arms the gesture when it is genuinely
 * at the top.
 *
 * <p>Called from the WebView's JavaScript thread, so the flag is volatile.
 */
public class PageStateBridge {

    private volatile boolean scrolledToTop = true;

    boolean isScrolledToTop() {
        return scrolledToTop;
    }

    void reset() {
        scrolledToTop = true;
    }

    @JavascriptInterface
    public void setScrolledToTop(boolean atTop) {
        scrolledToTop = atTop;
    }
}
