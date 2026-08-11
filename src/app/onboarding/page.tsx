"use client";

import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getClinicCollection } from "@/lib/db-utils";export default function OnboardingPage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [clinicName, setClinicName] = useState("");
  const [joinClinicId, setJoinClinicId] = useState("");
  const [loading, setLoading] = useState(false);

  if (!user) {
    return <div className="p-10 text-center">Please login first.</div>;
  }

  const handleCreateClinic = async () => {
    if (!clinicName.trim()) return alert("Clinic name is required");
    setLoading(true);
    try {
      // Clinic creation + self Admin-role grant happens server-side (Admin SDK) —
      // Firestore rules lock direct client writes to `clinics` and `users.clinicRoles`
      // down to superadmin-only, so this can't be done with a plain client-side write.
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/onboarding/create-clinic", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ clinicName }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to create clinic");
      }

      alert("Clinic created successfully!");
      router.push("/");
    } catch (err) {
      console.error(err);
      alert("Failed to create clinic. See console for details.");
    }
    setLoading(false);
  };

  const handleJoinClinic = async () => {
    if (!joinClinicId.trim()) return alert("Clinic ID is required");
    setLoading(true);
    try {
      const requestRef = doc(getClinicCollection("join_requests"));
      await setDoc(requestRef, {
        clinicId: joinClinicId.trim(),
        userId: user.uid,
        userEmail: user.email,
        userName: user.name,
        status: 'Pending',
        requestedAt: serverTimestamp()
      });
      alert("Request sent to clinic admin! You will be able to access the clinic once approved.");
      setJoinClinicId("");
    } catch (err) {
      console.error(err);
      alert("Failed to send join request.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Welcome, {user.name}!
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          {Object.keys(user.clinicRoles || {}).length > 0 
            ? "Create a new workspace or join an existing one." 
            : "You aren't associated with any clinics yet."}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 space-y-8">
          
          {/* Create Clinic */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Start a Free Trial</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Clinic Name</label>
                <div className="mt-1">
                  <input
                    type="text"
                    value={clinicName}
                    onChange={(e) => setClinicName(e.target.value)}
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="My Dental Clinic"
                  />
                </div>
              </div>
              <button
                onClick={handleCreateClinic}
                disabled={loading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 cursor-pointer"
              >
                Create New Clinic
              </button>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">Or join an existing one</span>
            </div>
          </div>

          {/* Join Clinic */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Join Existing Clinic</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Clinic ID</label>
                <div className="mt-1">
                  <input
                    type="text"
                    value={joinClinicId}
                    onChange={(e) => setJoinClinicId(e.target.value)}
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="Ask your admin for the ID"
                  />
                </div>
              </div>
              <button
                onClick={handleJoinClinic}
                disabled={loading}
                className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 cursor-pointer"
              >
                Request to Join
              </button>
            </div>
          </div>

        </div>

        <div className="mt-6 flex flex-col items-center gap-4">
          {Object.keys(user.clinicRoles || {}).length > 0 && (
             <button onClick={() => router.push("/")} className="text-sm font-medium text-blue-600 hover:text-blue-500">
                Cancel & Go back to Dashboard
             </button>
          )}
          <button onClick={logout} className="text-sm text-gray-500 hover:text-gray-900">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
