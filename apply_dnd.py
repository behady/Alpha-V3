import sys

with open('src/components/dashboard/DesktopDashboard.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'className="absolute group pointer-events-auto p-0.5"' in line:
        lines[i] = line.replace(
            'className="absolute group pointer-events-auto p-0.5"',
            'className="absolute group pointer-events-auto p-0.5 cursor-grab active:cursor-grabbing"\n' +
            '                                                            draggable={true}\n' +
            '                                                            onDragStart={(e) => {\n' +
            '                                                              e.dataTransfer.setData("text/plain", JSON.stringify({ id: apt.id, duration: apt.duration || 30 }));\n' +
            '                                                              setTimeout(() => { if (e.target instanceof HTMLElement) e.target.style.opacity = "0.5"; }, 0);\n' +
            '                                                            }}\n' +
            '                                                            onDragEnd={(e) => {\n' +
            '                                                              if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = "1";\n' +
            '                                                            }}'
        )

# For drop zones
for i, line in enumerate(lines):
    if 'className="border-b border-dashed border-slate-300/60 flex-1 relative pointer-events-auto cursor-pointer hover:bg-white/50 transition-colors group/slot"' in line:
        lines[i] = line.replace(
            'className="border-b border-dashed border-slate-300/60 flex-1 relative pointer-events-auto cursor-pointer hover:bg-white/50 transition-colors group/slot"',
            'className="border-b border-dashed border-slate-300/60 flex-1 relative pointer-events-auto cursor-pointer hover:bg-white/50 transition-colors group/slot"\n' +
            '                                                    onDragOver={(e) => e.preventDefault()}\n' +
            '                                                    onDrop={(e) => {\n' +
            '                                                        e.preventDefault();\n' +
            '                                                        const dataStr = e.dataTransfer.getData("text/plain");\n' +
            '                                                        if (!dataStr) return;\n' +
            '                                                        try {\n' +
            '                                                            const data = JSON.parse(dataStr);\n' +
            '                                                            updateBookingTime(data.id, dateKey, slot.label);\n' +
            '                                                        } catch(err) { console.error(err); }\n' +
            '                                                    }}'
        )

# Add import
import_line = 'import { updateBookingTime } from "@/lib/bookingService";\n'
if not any('updateBookingTime' in l for l in lines):
    for i, line in enumerate(lines):
        if 'import' in line and '@/lib/bookingService' in line:
            lines[i] = line.replace('}', ', updateBookingTime }')
            break

with open('src/components/dashboard/DesktopDashboard.tsx', 'w', encoding='utf-8') as f:
    f.writelines(lines)

