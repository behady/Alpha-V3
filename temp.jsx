                <div className="flex flex-col flex-1 min-h-[400px] overflow-hidden relative">
                    {loading ? (
                        <div className="py-32 flex justify-center"><Loader2 className="animate-spin text-primary-500" size={32} /></div>
                    ) : (
                        <div className="flex-1 overflow-y-auto overflow-x-auto custom-scrollbar relative">
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
                            ) : (() => {
                                const sched = config;
                                const bounds = clinicDayBoundsMinutes(sched);
                                const slotDuration = sched.slotDuration || 30;
                                const rowHeight = 148;
                                const pixelsPerMinute = rowHeight / slotDuration;
                                const totalMinutes = bounds.end - bounds.start;
                                const containerHeight = totalMinutes * pixelsPerMinute;
                                
                                const timeSlots = [];
                                for (let m = bounds.start; m < bounds.end; m += slotDuration) {
                                    const h = Math.floor(m / 60);
                                    const mins = m % 60;
                                    const ampm = h >= 12 ? (language === 'ar' ? 'م' : 'PM') : (language === 'ar' ? 'ص' : 'AM');
                                    const h12 = h % 12 || 12;
                                    const label = language === 'ar' ? `${ampm} ${h12.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}` : `${h12.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} ${ampm}`;
                                    timeSlots.push({ minutes: m, label });
                                }

                                return (
                                    <div className="relative min-w-0 lg:min-w-[600px] bg-white/40 backdrop-blur-xl rounded-[2rem] border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden" style={{ height: `${containerHeight}px` }}>
                                        <div className="absolute inset-0 flex flex-col pointer-events-none">
                                            {timeSlots.map((slot, idx) => (
                                                <div 
                                                    key={idx} 
                                                    className="border-b border-dashed border-slate-300/60 flex-1 relative pointer-events-auto cursor-pointer hover:bg-white/50 transition-colors group/slot"
                                                    style={{ height: `${rowHeight}px` }}
                                                    onClick={() => {
                                                        handleSelectAppointmentWrapper(null);
                                                        setAppointmentToEdit(null);
                                                        setPreSelectedTime(slot.label);
                                                        setActiveModal('booking');
                                                    }}
                                                >
                                                    <div className={`absolute start-6 md:start-8 bg-white/40 backdrop-blur-md px-3 py-0.5 text-xs font-bold text-slate-900 group-hover/slot:text-black transition-colors z-0 w-[96px] text-center rounded-full border border-white shadow-sm ${idx === 0 ? 'top-3' : 'top-0 -translate-y-1/2'}`}>
                                                        {slot.label}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="absolute inset-0 start-[88px] md:start-[104px] end-2 md:end-4 pointer-events-none">
                                            {(() => {
                                                const visibleAppts = appointments.filter(apt => {
                                                    const startMin = parseApptTimeToMinutes(apt.time);
                                                    return startMin >= bounds.start && startMin < bounds.end;
                                                }).map(apt => ({
                                                    ...apt,
                                                    startMin: parseApptTimeToMinutes(apt.time),
                                                    endMin: parseApptTimeToMinutes(apt.time) + (apt.duration || 30)
                                                })).sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

                                                const blocks: (typeof visibleAppts)[] = [];
                                                let currentBlock: typeof visibleAppts = [];
                                                let currentBlockEnd = 0;

                                                visibleAppts.forEach(apt => {
                                                    if (currentBlock.length > 0 && apt.startMin >= currentBlockEnd) {
                                                        blocks.push(currentBlock);
                                                        currentBlock = [];
                                                        currentBlockEnd = 0;
                                                    }
                                                    currentBlock.push(apt);
                                                    currentBlockEnd = Math.max(currentBlockEnd, apt.endMin);
                                                });
                                                if (currentBlock.length > 0) blocks.push(currentBlock);

                                                const positionedAppts: (typeof visibleAppts[0] & { colIndex: number, totalCols: number })[] = [];
                                                blocks.forEach(block => {
                                                    const columns: typeof visibleAppts[] = [];
                                                    block.forEach(apt => {
                                                        let placed = false;
                                                        for (let i = 0; i < columns.length; i++) {
                                                            const lastInCol = columns[i][columns[i].length - 1];
                                                            if (lastInCol.endMin <= apt.startMin) {
                                                                columns[i].push(apt);
                                                                positionedAppts.push({ ...apt, colIndex: i, totalCols: 0 });
                                                                placed = true;
                                                                break;
                                                            }
                                                        }
                                                        if (!placed) {
                                                            columns.push([apt]);
                                                            positionedAppts.push({ ...apt, colIndex: columns.length - 1, totalCols: 0 });
                                                        }
                                                    });
                                                    const numCols = columns.length;
                                                    block.forEach(apt => {
                                                        const pApt = positionedAppts.find(p => p.id === apt.id);
                                                        if (pApt) pApt.totalCols = numCols;
                                                    });
                                                });

                                                return positionedAppts.map((apt) => {
                                                    const topOffset = (apt.startMin - bounds.start) * pixelsPerMinute;
                                                    const durationMinutes = apt.endMin - apt.startMin;
                                                    const height = Math.max(durationMinutes * pixelsPerMinute, 120);
                                                    const aptStyles = getAppointmentStatusStyles(apt.status);
                                                    
                                                    const leftPercent = (apt.colIndex / apt.totalCols) * 100;
                                                    const widthPercent = (100 / apt.totalCols);

                                                    // Dynamic font sizes based on card size (duration)
                                                    let nameFontSize = "text-xs md:text-sm lg:text-base";
                                                    let timeFontSize = "text-[10px] md:text-xs lg:text-xs";
                                                    let infoFontSize = "text-[10px] md:text-xs lg:text-sm";

                                                    if (durationMinutes > 30 && durationMinutes <= 60) {
                                                        nameFontSize = "text-sm md:text-base lg:text-base";
                                                        timeFontSize = "text-xs md:text-sm lg:text-xs";
                                                        infoFontSize = "text-xs md:text-sm lg:text-sm";
                                                    } else if (durationMinutes > 60) {
                                                        nameFontSize = "text-base md:text-lg lg:text-base";
                                                        timeFontSize = "text-sm md:text-base lg:text-xs";
                                                        infoFontSize = "text-sm md:text-base lg:text-sm";
                                                    }

                                                    return (
                                                        <div 
                                                            key={apt.id}
                                                            className="absolute group pointer-events-auto p-0.5"
                                                            style={{ top: `${topOffset}px`, height: `${height}px`, left: `${leftPercent}%`, width: `${widthPercent}%`, zIndex: 10 + apt.colIndex }}
                                                        >
                                                        <div 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (isAppointmentLate(apt)) {
                                                                   setLateApptToPrompt(apt);
                                                                   return;
                                                                }
                                                                const currentTime = new Date().getTime();
                                                                const tapDelay = 300;
                                                                if (lastTapRef.current && (currentTime - lastTapRef.current.time) < tapDelay && lastTapRef.current.id === apt.id) {
                                                                    setAppointmentToEdit({
                                                                        id: apt.id, patientId: String(apt.patientId), patientName: apt.patientName!,
                                                                        treatment: apt.treatment!, doctor: apt.doctor!, date: apt.date!,
                                                                        time: apt.time!, duration: apt.duration!, clinicalNoteId: apt.clinicalNoteId ?? null,
                                                                        cost: apt.cost!,
                                                                        listPrice: apt.listPrice ?? undefined, discountMode: apt.discountMode ?? undefined,
                                                                        discountPercent: apt.discountPercent ?? undefined, discountFixed: apt.discountFixed ?? undefined,
                                                                        discountAmount: apt.discountAmount ?? undefined, notes: apt.notes!, status: apt.status || "Scheduled",
                                                                    });
                                                                    setActiveModal("booking");
                                                                    lastTapRef.current = null;
                                                                } else {
                                                                    lastTapRef.current = { time: currentTime, id: apt.id };
                                                                    handleSelectAppointmentWrapper(apt);
                                                                }
                                                            }}
                                                            className={`w-full h-full rounded-2xl border transition-all hover:scale-[1.01] hover:shadow-md hover:z-10 cursor-pointer overflow-hidden flex flex-col relative pl-3 shadow-sm lg:shadow-md lg:border-l-4 ${selectedAppointment?.id === apt.id ? 'ring-2 ring-primary-500 scale-[1.01] z-10 shadow-md' : ''} ${aptStyles.card.replace('opacity-80', '')} ${isAppointmentLate(apt) ? 'animate-pulse ring-4 ring-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.6)] z-30' : ''}`}
                                                            style={{ zIndex: selectedAppointment?.id === apt.id ? 20 : 1 }}
                                                        >
                                                            <div className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${aptStyles.accent}`}></div>
                                                            <div className="flex flex-col h-full p-2 lg:p-3 relative justify-between gap-1">
                                                                {/* TOP ROW: Name + Actions */}
                                                                <div className="flex justify-between items-start w-full gap-2">
                                                                    <div className="flex flex-col min-w-0">
                                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                                            <h4 className={`font-medium truncate drop-shadow-sm ${nameFontSize}`}>
                                                                                {apt.patientName}
                                                                            </h4>
                                                                            {(apt.status === "Checked In" || apt.waitingMood) && (
                                                                                <span onClick={(e) => e.stopPropagation()} className="shrink-0 scale-75 lg:scale-100 origin-left">
                                                                                    <WaitingMoodPicker
                                                                                        value={apt.waitingMood || "neutral"}
                                                                                        onChange={(m) => void handleWaitingMoodChange(apt.id, m)}
                                                                                        language={language === "ar" ? "ar" : "en"}
                                                                                    />
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        {patientsList.find(p => p.id === apt.patientId)?.phone && (
                                                                            <span className="text-[10px] text-slate-500 font-medium truncate mt-0.5" dir="ltr">
                                                                                {patientsList.find(p => p.id === apt.patientId)?.phone}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-0.5 shrink-0 z-20">
                                                                        {(() => {
                                                                           const getAction = () => {
                                                                               if (apt.status === "Scheduled") return { label: language === 'ar' ? 'وصول' : 'Arrive', next: "Arrived", color: "text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border-emerald-200" };
                                                                               if (apt.status === "Arrived") return { label: language === 'ar' ? 'دخول' : 'Seat', next: "Seated", color: "text-blue-600 bg-blue-50 hover:bg-blue-100 border-blue-200" };
                                                                               if (apt.status === "Seated") return { label: language === 'ar' ? 'خروج' : 'Check Out', next: "Checking Out", color: "text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border-indigo-200" };
                                                                               return null;
                                                                           };
                                                                           const action = getAction();
                                                                           if (!action) return null;
                                                                           return (
                                                                               <button 
                                                                                   onClick={(e) => { e.stopPropagation(); handleStatusChange(apt.id, action.next); }} 
                                                                                   className={`px-2 py-0.5 text-[10px] font-bold rounded border mr-1 transition-colors ${action.color}`}
                                                                               >
                                                                                   {action.label}
                                                                               </button>
                                                                           );
                                                                        })()}
                                                                        <button onClick={(e) => { 
                                                                          e.stopPropagation(); 
                                                                          setHistoryDrawerPatientId(String(apt.patientId));
                                                                          setHistoryDrawerPatientName(apt.patientName!);
                                                                        }} className="p-1 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-md transition-colors" title={language === 'ar' ? 'سجل الزيارات' : 'Visit History'}><Clock className="w-3.5 h-3.5 lg:w-4 lg:h-4" /></button>
                                                                        <button onClick={(e) => { e.stopPropagation(); router.push(`/patients/${apt.patientId}`); }} className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title={language === 'ar' ? 'الملف الشخصي' : 'Profile'}><User className="w-3.5 h-3.5 lg:w-4 lg:h-4" /></button>
                                                                        <button onClick={(e) => { e.stopPropagation(); setPaymentPatient({ id: apt.patientId!, name: apt.patientName! }); setActiveModal('payment'); }} className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors" title={language === 'ar' ? 'دفع' : 'Pay'}><Wallet className="w-3.5 h-3.5 lg:w-4 lg:h-4" /></button>
                                                                        <button onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setAppointmentToEdit({
                                                                                id: apt.id, patientId: String(apt.patientId), patientName: apt.patientName!,
                                                                                treatment: apt.treatment!, doctor: apt.doctor!, date: apt.date!,
                                                                                time: apt.time!, duration: apt.duration!, clinicalNoteId: apt.clinicalNoteId ?? null,
                                                                                cost: apt.cost!,
                                                                                listPrice: apt.listPrice ?? undefined, discountMode: apt.discountMode ?? undefined,
                                                                                discountPercent: apt.discountPercent ?? undefined, discountFixed: apt.discountFixed ?? undefined,
                                                                                discountAmount: apt.discountAmount ?? undefined, notes: apt.notes!, status: apt.status || "Scheduled",
                                                                            });
                                                                            setActiveModal("booking");
                                                                        }} className="p-1 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-md transition-colors" title={language === 'ar' ? 'تعديل' : 'Edit'}><Edit className="w-4 h-4 lg:w-4 lg:h-4" /></button>
                                                                        <button onClick={(e) => handleDeleteAppointment(e, apt.id)} className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors" title={language === 'ar' ? 'حذف' : 'Delete'}><Trash2 className="w-4 h-4 lg:w-4 lg:h-4" /></button>
                                                                    </div>
                                                                </div>

                                                                {/* BOTTOM ROW: Treatment + Time */}
                                                                <div className="flex justify-between items-end w-full gap-2 mt-1.5 min-h-0">
                                                                    <div className="flex flex-col gap-1 min-w-0">
                                                                       <p className={`text-slate-800 truncate font-bold bg-white/60 lg:bg-white/80 backdrop-blur-sm px-2 py-0.5 rounded-md shadow-sm min-w-0 ${infoFontSize}`}>
                                                                           {apt.treatment || "Consultation"} <span className="text-slate-400 mx-1 font-normal">•</span> Dr. {apt.doctor?.split(" ")[1] || apt.doctor}
                                                                       </p>
                                                                       <div className="pl-1 mt-0.5">
                                                                         <StarRating rating={apt.rating || 0} onRatingChange={(r) => handleRatingChange(apt.id, r)} size={14} />
                                                                       </div>
                                                                    </div>
                                                                    <span className={`font-black text-slate-600 lg:text-indigo-950 opacity-80 whitespace-nowrap shrink-0 bg-white/40 px-1.5 py-0.5 rounded-md ${timeFontSize}`}>
                                                                        {apt.time} ({durationMinutes}m)
                                                                    </span>
                                                                </div>
                                                            </div>
                                                         </div>
                                                     </div>
                                                 );
                                             })}
                                        </div>
                                    </div>
                                );
                            })()}
                            }
                        </div>
                    )}
                </div>
            </div>

            {/* 6. PATIENT LEDGER / EDIT PANEL */}
            <div className="hidden lg:flex w-full lg:w-[400px] xl:w-[450px] shrink-0 flex-col gap-4 z-20">
               {selectedAppointment ? (
                   <AppointmentSidePanel
                       selectedAppointment={selectedAppointment}
                       onClose={() => handleSelectAppointmentWrapper(null)}
                       onEditFull={(appt) => {
                           setAppointmentToEdit(appt);
                           setActiveModal("booking");
                       }}
                       onDelete={(id) => handleDeleteAppointment(null, id)}