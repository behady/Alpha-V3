const fs = require('fs');

let content = fs.readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');

// First, clean up the bad drops on the slots by removing them.
content = content.replace(
    /onDragOver=\{\(e\) => e.preventDefault\(\)\}\s*onDrop=\{\(e\) => \{[\s\S]*?\}\}/g,
    ''
);

// Second, remove that extra ); from the text:
content = content.replace(
    '                                                  );\n                                                                       <p',
    '                                                                       <p'
);

// Add the drop handler to the main container
content = content.replace(
    'className="relative min-w-0 lg:min-w-[600px] bg-white/40 backdrop-blur-xl rounded-[2rem] border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden" style={{ height: `${containerHeight}px` }}',
    `className="relative min-w-0 lg:min-w-[600px] bg-white/40 backdrop-blur-xl rounded-[2rem] border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden" style={{ height: \`\${containerHeight}px\` }}
                                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const dataStr = e.dataTransfer.getData("text/plain");
                                        if (!dataStr) return;
                                        try {
                                            const data = JSON.parse(dataStr);
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const y = e.clientY - rect.top;
                                            
                                            const pixelsPerMinute = rowHeight / 5;
                                            const minsFromStart = Math.round((y / pixelsPerMinute) / 5) * 5;
                                            const m = bounds.start + minsFromStart;
                                            const h = Math.floor(m / 60);
                                            const mins = m % 60;
                                            const newTime = \`\${h.toString().padStart(2, '0')}:\${mins.toString().padStart(2, '0')}\`;
                                            
                                            updateBookingTime(data.id, scheduleViewDate, newTime);
                                        } catch(err) { console.error(err); }
                                    }}`
);


// In WeeklyScheduleView, do the same!
let weekly = fs.readFileSync('src/components/dashboard/WeeklyScheduleView.tsx', 'utf8');

weekly = weekly.replace(
    /onDragOver=\{\(e\) => e.preventDefault\(\)\}\s*onDrop=\{\(e\) => \{[\s\S]*?\}\}/g,
    ''
);

// In WeeklyScheduleView, the column is what we want to drop on, because we need to know WHICH DAY it is!
// The column has: className="flex-1 relative border-e border-slate-300/40 last:border-e-0 group/col"
weekly = weekly.replace(
    'className="flex-1 relative border-e border-slate-300/40 last:border-e-0 group/col"',
    `className="flex-1 relative border-e border-slate-300/40 last:border-e-0 group/col"
                                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const dataStr = e.dataTransfer.getData("text/plain");
                                        if (!dataStr) return;
                                        try {
                                            const data = JSON.parse(dataStr);
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const y = e.clientY - rect.top;
                                            
                                            const minsFromStart = Math.round((y / pixelsPerMinute) / 5) * 5;
                                            const m = bounds.start + minsFromStart;
                                            const h = Math.floor(m / 60);
                                            const mins = m % 60;
                                            const newTime = \`\${h.toString().padStart(2, '0')}:\${mins.toString().padStart(2, '0')}\`;
                                            
                                            updateBookingTime(data.id, dateStr, newTime);
                                        } catch(err) { console.error(err); }
                                    }}`
);

fs.writeFileSync('src/components/dashboard/DesktopDashboard.tsx', content);
fs.writeFileSync('src/components/dashboard/WeeklyScheduleView.tsx', weekly);

