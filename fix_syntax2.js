const fs = require('fs');
let c = fs.readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
const lines = c.split('\n');
lines[176] = '    const q = query(';
c = lines.join('\n');
fs.writeFileSync('src/components/dashboard/DesktopDashboard.tsx', c);
console.log('Fixed line 177');
