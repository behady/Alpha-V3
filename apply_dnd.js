const fs = require('fs');

let content = fs.readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');

// Replace card
content = content.replace(
    'className="absolute group pointer-events-auto p-0.5"',
    `className="absolute group pointer-events-auto p-0.5 cursor-grab active:cursor-grabbing"
                                                            draggable={true}
                                                            onDragStart={(e) => {
                                                              e.dataTransfer.setData("text/plain", JSON.stringify({ id: apt.id, duration: apt.duration || 30 }));
                                                              setTimeout(() => { if (e.target instanceof HTMLElement) e.target.style.opacity = "0.5"; }, 0);
                                                            }}
                                                            onDragEnd={(e) => {
                                                              if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = "1";
                                                            }}`
);

// Replace drop zone
content = content.replace(
    'className="border-b border-dashed border-slate-300/60 flex-1 relative pointer-events-auto cursor-pointer hover:bg-white/50 transition-colors group/slot"',
    `className="border-b border-dashed border-slate-300/60 flex-1 relative pointer-events-auto cursor-pointer hover:bg-white/50 transition-colors group/slot"
                                                    onDragOver={(e) => e.preventDefault()}
                                                    onDrop={(e) => {
                                                        e.preventDefault();
                                                        const dataStr = e.dataTransfer.getData("text/plain");
                                                        if (!dataStr) return;
                                                        try {
                                                            const data = JSON.parse(dataStr);
                                                            updateBookingTime(data.id, dateKey, slot.label);
                                                        } catch(err) { console.error(err); }
                                                    }}`
);

// Add import
if (!content.includes('updateBookingTime')) {
    content = content.replace('} from "@/lib/bookingService";', ', updateBookingTime } from "@/lib/bookingService";');
}

fs.writeFileSync('src/components/dashboard/DesktopDashboard.tsx', content);
