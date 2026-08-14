"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, onSnapshot, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { UserProfile } from "@/types/saas";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeUserDoc: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        if (unsubscribeUserDoc) unsubscribeUserDoc();
        
        try {
          // Ensure user document exists (if this is their first time logging in)
          const userRef = getClinicDoc("users", firebaseUser.uid);
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            const newProfile: Partial<UserProfile> = {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              name: firebaseUser.displayName || "Unknown User",
              createdAt: serverTimestamp(),
            };
            /**
             * Merge, and never write `clinicRoles` here.
             *
             * There is a real gap between the getDoc above and this write, and signup fills it:
             * /api/onboarding/create-clinic grants the owner's Admin role on this same document
             * from the server. A plain setDoc() replaces the document, so a grant that landed in
             * that gap would be erased — putting the new owner back on "you're not part of a
             * clinic yet" with a clinic they can no longer reach. Roles are only ever written
             * server-side; this write's job is just the profile fields.
             */
            await setDoc(userRef, newProfile, { merge: true });
          }

          unsubscribeUserDoc = onSnapshot(
            userRef,
            (docSnap) => {
              if (docSnap.exists()) {
                setUser({ uid: firebaseUser.uid, ...docSnap.data() } as UserProfile);
              } else {
                setUser(null);
              }
              setLoading(false);
            },
            (error) => {
              console.error("Error fetching user profile:", error);
              setLoading(false);
            }
          );
        } catch (err) {
          console.error("Error initializing user profile:", err);
          setLoading(false);
        }
      } else {
        setUser(null);
        setLoading(false);
        if (unsubscribeUserDoc) unsubscribeUserDoc();
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUserDoc) unsubscribeUserDoc();
    };
  }, []);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};