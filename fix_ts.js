const fs = require('fs');
let c = fs.readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');

c = c.replace(
  'if (typeof window !== "undefined" && window.alert) alert("Error fetching appointments: " + err.message);',
  'if (typeof window !== "undefined") window.alert("Error fetching appointments: " + err.message);'
);

fs.writeFileSync('src/components/dashboard/DesktopDashboard.tsx', c);
console.log('Fixed TS error');
