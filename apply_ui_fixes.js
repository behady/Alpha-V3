const fs = require('fs');

let lines = fs.readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8').split('\n');

const toInsert = `                                                                       <p className={\`text-slate-800 truncate font-bold bg-white/60 lg:bg-white/80 backdrop-blur-sm px-2 py-0.5 rounded-md shadow-sm min-w-0 \${infoFontSize}\`}>
                                                                           {apt.treatment || "Consultation"} <span className="text-slate-400 mx-1 font-normal">•</span> Dr. {apt.doctor?.split(" ")[1] || apt.doctor}
                                                                       </p>
                                                                       <div className="pl-1 mt-0.5">
                                                                         <StarRating rating={apt.rating || 0} onRatingChange={(r) => handleRatingChange(apt.id, r)} size={14} />
                                                                       </div>
                                                                    </div>
                                                                    <span className={\`font-black text-slate-600 lg:text-indigo-950 opacity-80 whitespace-nowrap shrink-0 bg-white/40 px-1.5 py-0.5 rounded-md \${timeFontSize}\`}>
                                                                        {apt.time} ({durationMinutes}m)
                                                                    </span>
                                                                </div>
                                                            </div>
                                                         </div>
                                                         {/* Hover Tooltip */}
                                                         <div className="absolute hidden group-hover:flex flex-col z-[100] bg-white shadow-2xl rounded-xl p-4 border border-slate-200 w-64 top-full start-0 mt-1 pointer-events-none">
                                                             <div className="font-bold text-base text-slate-900">{apt.patientName}</div>
                                                             {patientsList.find(p => p.id === apt.patientId)?.phone && (
                                                                 <div className="text-sm text-slate-600 mt-0.5">{patientsList.find(p => p.id === apt.patientId)?.phone}</div>
                                                             )}
                                                             <hr className="my-2 border-slate-100" />
                                                             <div className="text-sm font-medium text-slate-800">{apt.treatment || 'Consultation'}</div>
                                                             {apt.doctor && <div className="text-sm text-slate-500 mt-0.5">Dr. {apt.doctor}</div>}
                                                             <div className="text-sm text-indigo-600 font-bold mt-2 bg-indigo-50 px-2 py-1 rounded-md self-start">{apt.time} - {durationMinutes} min</div>
                                                         </div>
                                                     </div>`.split('\n');

lines.splice(1282, 0, ...toInsert);
fs.writeFileSync('src/components/dashboard/DesktopDashboard.tsx', lines.join('\n'));

// Now add the updateBookingTime to bookingService.ts
let bookingService = fs.readFileSync('src/lib/bookingService.ts', 'utf8');
if(!bookingService.includes('updateBookingTime')) {
  bookingService += `
export async function updateBookingTime(id: string, newDate: string, newTime: string): Promise<void> {
  const ref = doc(db, 'bookings', id);
  await updateDoc(ref, { date: newDate, time: newTime });
}
`;
  fs.writeFileSync('src/lib/bookingService.ts', bookingService);
}
