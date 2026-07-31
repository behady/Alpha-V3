const fs = require('fs');
let c = fs.readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');

const oldStr = `    const 
      collection(db, "ledger"),`;
const newStr = `    const q = query(
      collection(db, "ledger"),`;

c = c.replace(oldStr, newStr);

fs.writeFileSync('src/components/dashboard/DesktopDashboard.tsx', c);
console.log('Fixed line 177');
