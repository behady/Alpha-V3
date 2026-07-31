const fs = require('fs');

const file = 'src/components/dashboard/DesktopDashboard.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add viewMode state
if (!content.includes("const [viewMode, setViewMode]")) {
  const targetState = "const [allAppointments, setAllAppointments] = useState<any[]>([]);";
  content = content.replace(targetState, "const [viewMode, setViewMode] = useState<'day' | 'week'>('day');\n  const [allAppointments, setAllAppointments] = useState<any[]>([]);");
}

// 2. Add WeeklyScheduleView import
if (!content.includes("WeeklyScheduleView")) {
  const targetImport = "import DesktopDashboard from"; // wait, DesktopDashboard doesn't import itself
  const targetImport2 = 'import UserClockWidget from "@/components/dashboard/UserClockWidget";';
  content = content.replace(targetImport2, targetImport2 + '\nimport WeeklyScheduleView from "@/components/dashboard/WeeklyScheduleView";');
}

// 3. Update appointments fetch logic
const targetFetch = `  // Fetch only appointments for the current view date to prevent severe performance degradation
  // and browser freezes when saving.
  useEffect(() => {
    setLoading(true);
    const viewKey = normalizeDateKey(scheduleViewDate) || scheduleViewDate;
    const q = query(collection(db, "appointments"), where("date", "==", viewKey));

    const unsubAppts = onSnapshot(
      q,`;
      
const replacementFetch = `  // Fetch appointments (Day or Week)
  useEffect(() => {
    setLoading(true);
    const viewKey = normalizeDateKey(scheduleViewDate) || scheduleViewDate;
    
    let q;
    if (viewMode === 'day') {
      q = query(collection(db, "appointments"), where("date", "==", viewKey));
    } else {
      // Calculate start and end of week (Saturday to Friday)
      const d = new Date(viewKey);
      const diffToSat = (d.getDay() + 1) % 7; // if Sunday (0), diff is 1. If Saturday (6), diff is 0
      const startOfWeek = new Date(d);
      startOfWeek.setDate(d.getDate() - diffToSat);
      
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      
      const startStr = startOfWeek.toISOString().split('T')[0];
      const endStr = endOfWeek.toISOString().split('T')[0];
      q = query(collection(db, "appointments"), where("date", ">=", startStr), where("date", "<=", endStr));
    }

    const unsubAppts = onSnapshot(
      q,`;
content = content.replace(targetFetch, replacementFetch);

// 4. Update the UI for the Segmented Toggle
const targetHeader = `<div className="flex justify-between items-center gap-3 px-4 md:px-6 py-4 border-b border-white/40 bg-transparent shrink-0">`;
const replacementHeader = `<div className="flex justify-between items-center gap-3 px-4 md:px-6 py-4 border-b border-white/40 bg-transparent shrink-0">
                    {/* View Toggle */}
                    <div className="flex bg-slate-200/50 p-1 rounded-xl shadow-inner backdrop-blur-sm">
                      <button onClick={() => setViewMode('day')} className={\`px-4 py-1.5 text-xs font-bold rounded-lg transition-all \${viewMode === 'day' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}\`}>{language === 'ar' ? 'يومي' : 'Day'}</button>
                      <button onClick={() => setViewMode('week')} className={\`px-4 py-1.5 text-xs font-bold rounded-lg transition-all \${viewMode === 'week' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}\`}>{language === 'ar' ? 'أسبوعي' : 'Week'}</button>
                    </div>`;
content = content.replace(targetHeader, replacementHeader);

// 5. Swap out the rendering of the schedule
const targetScheduleUI = `<div className="flex-1 overflow-y-auto overflow-x-auto custom-scrollbar relative">`;
const replacementScheduleUI = `<div className="flex-1 overflow-y-auto overflow-x-auto custom-scrollbar relative">
                            {viewMode === 'week' ? (
                                <WeeklyScheduleView 
                                    appointments={appointments} 
                                    currentDate={scheduleViewDate} 
                                    language={language}
                                    config={config}
                                    onSelectAppointment={(apt, time, date) => {
                                        if (apt) {
                                            handleSelectAppointmentWrapper(apt);
                                        } else {
                                            handleSelectAppointmentWrapper(null);
                                            setAppointmentToEdit(null);
                                            setPreSelectedTime(time || "");
                                            // The booking modal uses selected date from context or state, 
                                            // so we'd need to set scheduleViewDate if they click a different day.
                                            // For now we'll set it so the booking modal opens correctly.
                                            if (date) setScheduleViewDate(date);
                                            setActiveModal('booking');
                                        }
                                    }}
                                />
                            ) : (() => {`;
// Find the end of the IIFE for the day view and wrap it properly.
// The IIFE ends with `})()}` right before `</div>` (the closing of flex-1 custom-scrollbar)
content = content.replace(targetScheduleUI, replacementScheduleUI);

// Now find `})()}` that closes the Day view.
// It's followed by `</div>` and then `)}` and `</div>`
const targetEndIIFE = `})()}
                        </div>`;
const replacementEndIIFE = `})()}
                            )}
                        </div>`;
content = content.replace(targetEndIIFE, replacementEndIIFE);

fs.writeFileSync(file, content, 'utf8');
console.log('DesktopDashboard updated successfully.');
