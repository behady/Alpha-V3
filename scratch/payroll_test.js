const fs = require('fs');

// Helpers from page.tsx
function timeToMins(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h * 60) + m;
}

const getDefaultSchedule = () => {
    const s = {};
    for (let i = 0; i < 7; i++) {
        s[i] = { active: i >= 0 && i <= 4, start: "13:00", end: "21:00" }; // Sun to Thu, 8 hrs
    }
    return s;
};

// Simulation Function (mirrors payrollData useMemo exactly)
function simulatePayroll(staffConfig, logs) {
    const staffMap = {};
    const uid = staffConfig.uid;

    const schedule = staffConfig.schedule || getDefaultSchedule();
    const overtimeMultiplier = staffConfig.overtimeMultiplier || 1.5;
    const baseSalary = Number(staffConfig.baseSalary) || 0;
    
    // Exact logic from page.tsx:
    let expectedWeeklyMins = 0;
    Object.values(schedule).forEach(dayConfig => {
        if (dayConfig.active) expectedWeeklyMins += (timeToMins(dayConfig.end) - timeToMins(dayConfig.start));
    });
    const expectedMonthlyHours = (expectedWeeklyMins * 4) / 60;
    const hourlyRate = expectedMonthlyHours > 0 ? (baseSalary / expectedMonthlyHours) : 0;

    staffMap[uid] = {
        id: uid, uid, schedule, overtimeMultiplier, hourlyRate, expectedMonthlyHours, baseSalary,
        regularMinutes: 0, overtimeMinutes: 0, missingMinutes: 0, shiftsWorked: 0
    };

    logs.forEach(log => {
        let durationMinutes = log.durationMinutes || 0;
        
        if (log.status === 'completed' && log.durationMinutes) {
            staffMap[uid].shiftsWorked += 1;
        }

        if (log.status === 'completed' && log.durationMinutes) {
            const checkInDate = new Date(log.checkIn);
            const dayOfWeek = checkInDate.getDay();
            const dayConfig = staffMap[uid].schedule[dayOfWeek];

            if (!dayConfig || !dayConfig.active) {
                staffMap[uid].overtimeMinutes += durationMinutes;
            } else {
                const expectedMins = timeToMins(dayConfig.end) - timeToMins(dayConfig.start);
                if (durationMinutes > expectedMins) {
                    staffMap[uid].regularMinutes += expectedMins;
                    staffMap[uid].overtimeMinutes += (durationMinutes - expectedMins);
                } else {
                    staffMap[uid].regularMinutes += durationMinutes;
                    staffMap[uid].missingMinutes += (expectedMins - durationMinutes);
                }
            }
        }
    });

    const staff = staffMap[uid];
    const regularPay = (staff.regularMinutes / 60) * staff.hourlyRate;
    const overtimePay = (staff.overtimeMinutes / 60) * (staff.hourlyRate * staff.overtimeMultiplier);
    const estimatedBasePay = regularPay + overtimePay;

    return {
        ...staff,
        regularPay,
        overtimePay,
        estimatedBasePay,
        hourlyRate
    };
}

// -------------------------------------------------------------------
// Scenarios
// -------------------------------------------------------------------

const runTests = () => {
    let output = "=== PAYROLL LOGIC ACCURACY TEST ===\n\n";

    // Scenario 1: A perfect month.
    // 30 days in month. 22 working days (Sun-Thu).
    const staff = {
        uid: "staff_1",
        baseSalary: 10000,
        schedule: getDefaultSchedule(), // 8 hours * 5 days = 40 hours/week
        overtimeMultiplier: 1.5
    };

    let perfectMonthLogs = [];
    let d = new Date("2026-06-01T00:00:00Z"); // June 1, 2026 is Monday
    for(let i = 0; i < 30; i++) {
        let currentDay = new Date(d);
        currentDay.setDate(currentDay.getDate() + i);
        let dayOfWeek = currentDay.getDay();
        if (dayOfWeek >= 0 && dayOfWeek <= 4) { // Sun to Thu
            perfectMonthLogs.push({
                checkIn: currentDay.toISOString(),
                status: 'completed',
                durationMinutes: 8 * 60 // exact 8 hours
            });
        }
    }

    const res1 = simulatePayroll(staff, perfectMonthLogs);
    output += `SCENARIO 1: Perfect Attendance (Full Month)\n`;
    output += `Staff Base Salary: ${staff.baseSalary} EGP\n`;
    output += `Expected Monthly Hours (Formula): ${res1.expectedMonthlyHours} hours\n`;
    output += `Actual Hours Worked (22 days * 8h): ${res1.regularMinutes / 60} hours\n`;
    output += `Calculated Hourly Rate: ${res1.hourlyRate} EGP/hr\n`;
    output += `Final Computed Base Pay: ${res1.estimatedBasePay} EGP\n`;
    output += `Discrepancy: ${(res1.estimatedBasePay - staff.baseSalary)} EGP overpaid\n\n`;


    // Scenario 2: Arriving late but staying late.
    // Scheduled 13:00 to 21:00 (8 hours). 
    // Works 16:00 to 24:00 (8 hours).
    const lateShiftLogs = [{
        checkIn: "2026-06-01T16:00:00Z", // Clock in 3 hours late
        status: 'completed',
        durationMinutes: 8 * 60 // still 8 hours
    }];
    const res2 = simulatePayroll(staff, lateShiftLogs);
    output += `SCENARIO 2: Clock-in 3 Hours Late, Leave 3 Hours Late (Same total duration)\n`;
    output += `Scheduled: 13:00 - 21:00. Actual: 16:00 - 00:00\n`;
    output += `Expected Missing Hours: 3 hours\n`;
    output += `Calculated Missing Hours: ${res2.missingMinutes / 60} hours\n`;
    output += `Calculated Overtime Hours: ${res2.overtimeMinutes / 60} hours\n`;
    output += `Result: Flawed shift overlap logic. It only compares total duration, completely ignoring shift start/end times.\n\n`;

    fs.writeFileSync('./scratch/test_results.txt', output);
    console.log("Tests completed and saved.");
};

runTests();
