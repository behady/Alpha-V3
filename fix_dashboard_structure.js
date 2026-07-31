const fs = require('fs');

let content = fs.readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
const lines = content.split('\n');

// Find and fix the broken section around line 582
// Line 582 should be: "    return () => unsubAppts();"
// Line 583 should NOT directly have the patients query - it's missing the useEffect close and useMemo

// Find the exact broken spot
let breakIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('return () => unsubAppts();') && i + 1 < lines.length && lines[i+1].includes('query(collection(db, "patients")')) {
    breakIdx = i;
    break;
  }
}

if (breakIdx === -1) {
  console.log("Could not find the broken section!");
  process.exit(1);
}

console.log("Found broken section at line", breakIdx + 1);
console.log("Line:", lines[breakIdx]);
console.log("Next:", lines[breakIdx + 1]);

// Replace line breakIdx and insert the missing code
const replacement = [
  '    return () => unsubAppts();',
  '  }, [scheduleViewDate, viewMode]);',
  '',
  '  const appointments = useMemo(() => {',
  "    if (viewMode === 'week') {",
  '      // In week view, pass ALL fetched appointments through (already scoped to the week by the query)',
  '      return [...allAppointments].sort((a, b) => normalizeTimeKey(a.time).localeCompare(normalizeTimeKey(b.time)));',
  '    }',
  '    const viewKey = normalizeDateKey(scheduleViewDate) || scheduleViewDate;',
  '    return allAppointments',
  '      .filter((a) => normalizeDateKey(a.date) === viewKey)',
  '      .sort((a, b) => normalizeTimeKey(a.time).localeCompare(normalizeTimeKey(b.time)));',
  '  }, [allAppointments, scheduleViewDate, viewMode]);',
  '',
  '  // 2. Live lists (patients, doctors, services) so dashboard actions sync without refresh.',
  '  useEffect(() => {',
  '    const unsubPatients = onSnapshot(',
];

// Remove the broken line and splice in the replacement
lines.splice(breakIdx, 1, ...replacement);

content = lines.join('\n');
fs.writeFileSync('src/components/dashboard/DesktopDashboard.tsx', content);
console.log("Fixed! Total lines now:", content.split('\n').length);
