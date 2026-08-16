"use client";

import { Calendar, Clock, Stethoscope, Hourglass, Building2, DoorOpen } from "lucide-react";
import AppointmentStagePicker from "@/components/appointments/AppointmentStagePicker";
import type { ClinicBranch } from "@/lib/clinicLocations";

interface Props {
  language: string;
  txt: any;
  date: string;
  setDate: (v: string) => void;
  time: string;
  setTime: (v: string) => void;
  availableTimes: string[];
  displayTime: (t: string) => string;
  doctor: string;
  setDoctor: (v: string) => void;
  doctors: { id: string; name: string }[];
  branches?: ClinicBranch[];
  branchId?: string;
  setBranchId?: (v: string) => void;
  roomId?: string;
  setRoomId?: (v: string) => void;
  duration: number;
  setDuration: (v: number) => void;
  durationOptions: { label: string; value: number }[];
  appointmentStatus: string;
  setAppointmentStatus: (v: string) => void;
  visitNotes: string;
  setVisitNotes: (v: string) => void;
  getLocalDate: () => string;
}

export default function SlotPicker({
  language,
  txt,
  date,
  setDate,
  time,
  setTime,
  availableTimes,
  displayTime,
  doctor,
  setDoctor,
  doctors,
  branches = [],
  branchId = "",
  setBranchId,
  roomId = "",
  setRoomId,
  duration,
  setDuration,
  durationOptions,
  appointmentStatus,
  setAppointmentStatus,
  visitNotes,
  setVisitNotes,
  getLocalDate,
}: Props) {
  const selectedBranch = branches.find((b) => b.id === branchId) || null;
  const branchRooms = selectedBranch?.rooms ?? [];

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase text-slate-400">
            <Calendar size={11} /> {txt.date}
          </label>
          <input
            type="date"
            required
            min={getLocalDate()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border-2 border-slate-100 px-3 py-2.5 text-xs font-bold uppercase text-slate-900 outline-none focus:border-primary-500"
          />
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase text-slate-400">
            <Clock size={11} /> {txt.clock}
          </label>
          <select
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full rounded-xl border-2 border-slate-100 bg-white px-3 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-primary-500"
          >
            {availableTimes.map((t) => (
              <option key={t} value={t}>
                {displayTime(t)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase text-slate-400">
            <Stethoscope size={11} /> {txt.doctor}
          </label>
          <select
            value={doctor}
            onChange={(e) => setDoctor(e.target.value)}
            className="w-full rounded-xl border-2 border-slate-100 bg-white px-3 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-primary-500"
          >
            {doctors.length === 0 && <option>{txt.noDoctors}</option>}
            {doctors.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase text-slate-400">
            <Hourglass size={11} /> {txt.duration}
          </label>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full rounded-xl border-2 border-slate-100 bg-white px-3 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-primary-500"
          >
            {durationOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {branches.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase text-slate-400">
              <Building2 size={11} /> {txt.branch}
            </label>
            <select
              value={branchId}
              onChange={(e) => setBranchId?.(e.target.value)}
              className="w-full rounded-xl border-2 border-slate-100 bg-white px-3 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-primary-500"
            >
              {/* With several branches, an unpicked branch is a real state — say so instead of
                  silently displaying the first option while the value is empty. */}
              {branches.length > 1 && <option value="">{txt.pickBranchFirst}</option>}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase text-slate-400">
              <DoorOpen size={11} /> {txt.room}
            </label>
            <select
              value={roomId}
              onChange={(e) => setRoomId?.(e.target.value)}
              disabled={!selectedBranch || branchRooms.length === 0}
              className="w-full rounded-xl border-2 border-slate-100 bg-white px-3 py-2.5 text-xs font-bold text-slate-900 outline-none focus:border-primary-500 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">
                {!selectedBranch
                  ? txt.pickBranchFirst
                  : branchRooms.length === 0
                    ? txt.noRooms
                    : txt.anyRoom}
              </option>
              {branchRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
        <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">
          {language === "ar" ? "مرحلة الموعد" : "Appointment stage"}
        </label>
        <AppointmentStagePicker
          value={appointmentStatus}
          onChange={setAppointmentStatus}
          language={language === "ar" ? "ar" : "en"}
          isolateClicks={false}
        />
      </div>

      <div>
        <label className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase text-slate-400">
          {txt.notesLabel}
        </label>
        <textarea
          value={visitNotes}
          onChange={(e) => setVisitNotes(e.target.value)}
          rows={2}
          placeholder=""
          className="w-full rounded-xl border-2 border-slate-100 px-3 py-2.5 text-xs font-medium text-slate-800 outline-none focus:border-primary-500 resize-none"
        />
      </div>
    </>
  );
}
