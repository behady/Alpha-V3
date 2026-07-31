const fs = require('fs');

let content = fs.readFileSync('src/components/dashboard/WeeklyScheduleView.tsx', 'utf8');

// Replace card
content = content.replace(
    'className={`absolute start-0 end-0 mx-1 p-1.5 rounded-xl border pointer-events-auto cursor-pointer group hover:z-50 hover:scale-[1.02] hover:shadow-lg transition-all flex flex-col ${styles.card.replace(\'opacity-80\', \'\')}`}',
    `className={\`absolute start-0 end-0 mx-1 p-1.5 rounded-xl border pointer-events-auto cursor-pointer group hover:z-50 hover:scale-[1.02] hover:shadow-lg transition-all flex flex-col \${styles.card.replace('opacity-80', '')} cursor-grab active:cursor-grabbing\`}
                                                    draggable={true}
                                                    onDragStart={(e) => {
                                                        e.dataTransfer.setData("text/plain", JSON.stringify({ id: apt.id }));
                                                        setTimeout(() => { if (e.target instanceof HTMLElement) e.target.style.opacity = '0.5'; }, 0);
                                                    }}
                                                    onDragEnd={(e) => {
                                                        if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = '1';
                                                    }}`
);

// Replace drop zone
content = content.replace(
    'className="flex-1 border-r border-slate-200 last:border-r-0 relative"',
    `className="flex-1 border-r border-slate-200 last:border-r-0 relative"
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                        e.preventDefault();
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
                                            
                                            updateBookingTime(data.id, dateKey, newTime);
                                        } catch (err) { console.error(err); }
                                    }}`
);

fs.writeFileSync('src/components/dashboard/WeeklyScheduleView.tsx', content);
