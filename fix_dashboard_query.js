const fs = require('fs');
let c = fs.readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');

// Remove orderBy
c = c.replace(/,\s*orderBy\("date", "asc"\)/g, '');

// Clean up the bad console log I added
c = c.replace(/console\.log\('DASHBOARD QUERY DATES:', \{startStr, endStr, viewMode\}\); q = query\(/g, '');

// Change the warning to an error + alert so the user sees it!
c = c.replace(
  'console.warn("Dashboard appointments listener failed:", err);',
  'console.error("Dashboard appointments listener failed:", err);\n        if (typeof window !== "undefined" && window.alert) alert("Error fetching appointments: " + err.message);'
);

fs.writeFileSync('src/components/dashboard/DesktopDashboard.tsx', c);
console.log('Done!');
