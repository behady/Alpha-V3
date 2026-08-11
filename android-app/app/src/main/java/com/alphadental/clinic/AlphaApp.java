package com.alphadental.clinic;

import android.app.Application;
import android.content.Context;

/** Holds an application context so helpers do not have to thread one around. */
public class AlphaApp extends Application {

    private static Context appContext;

    static Context get() {
        return appContext;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        appContext = getApplicationContext();
    }
}
