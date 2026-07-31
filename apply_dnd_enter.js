const fs = require('fs');

let content = fs.readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');

content = content.replace(
    'onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}',
    `onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}\n                                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}`
);

let weekly = fs.readFileSync('src/components/dashboard/WeeklyScheduleView.tsx', 'utf8');

weekly = weekly.replace(
    'onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}',
    `onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}\n                                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}`
);

fs.writeFileSync('src/components/dashboard/DesktopDashboard.tsx', content);
fs.writeFileSync('src/components/dashboard/WeeklyScheduleView.tsx', weekly);

