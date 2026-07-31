const fs = require('fs');

let content = fs.readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');

const regex = /useEffect\(\(\) => \{\s*setLoading\(true\);\s*const viewKey = normalizeDateKey\(scheduleViewDate\) \|\| scheduleViewDate;\s*const q = query\(collection\(db, "appointments"\), where\("date", "==", viewKey\)\);\s*const unsubAppts = onSnapshot\([\s\S]*?return \(\) => unsubAppts\(\);\s*\}, \[scheduleViewDate\]\);/;

const replacement = `useEffect(() => {
    setLoading(true);
    const viewKey = normalizeDateKey(scheduleViewDate) || scheduleViewDate;
    let q;
    
    if (viewMode === 'week') {
      const d = new Date(scheduleViewDate);
      const day = d.getDay();
      const diffToSat = day === 6 ? 0 : (day === 0 ? 1 : day + 1);
      const startOfWeek = new Date(d);
      startOfWeek.setDate(d.getDate() - diffToSat);
      
      const dates = [];
      for (let i = 0; i < 7; i++) {
        const cur = new Date(startOfWeek);
        cur.setDate(startOfWeek.getDate() + i);
        dates.push(cur.toISOString().split('T')[0]);
      }
      q = query(collection(db, "appointments"), where("date", "in", dates));
    } else {
      q = query(collection(db, "appointments"), where("date", "==", viewKey));
    }

    const unsubAppts = onSnapshot(
      q,
      (snap) => {
        setAllAppointments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.warn("Dashboard appointments listener failed:", err);
        setLoading(false);
      }
    );
    return () => unsubAppts();
  }, [scheduleViewDate, viewMode]);`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync('src/components/dashboard/DesktopDashboard.tsx', content);
    console.log("Successfully updated DesktopDashboard.tsx");
} else {
    console.log("Regex did not match!");
}
