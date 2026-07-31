const fs = require('fs');

let content = fs.readFileSync('src/components/dashboard/DesktopDashboard.tsx', 'utf8');
const lines = content.split('\n');

console.log("Before fix, total lines:", lines.length);
console.log("Line 334:", JSON.stringify(lines[333]));
console.log("Line 335:", JSON.stringify(lines[334]));
console.log("Line 539:", JSON.stringify(lines[538]));
console.log("Line 540:", JSON.stringify(lines[539]));
console.log("Line 541:", JSON.stringify(lines[540]));

// Lines 330-334 have the original handleSelectAppointmentWrapper start (but it's broken)
// Lines 335-539: duplicate block + second copy of handleSelectAppointmentWrapper (correct one)
// Lines 540+: the weekly fetch useEffect (which is good)

// Strategy: Remove lines 334 through 539 (0-indexed: 333 through 538)
// And replace them with the proper completion of handleSelectAppointmentWrapper

const fixedLines = [
  '          ? "لديك تغييرات غير محفوظة. هل تريد حفظها قبل المتابعة؟"',
  '          : "You have unsaved changes. Do you want to save them before proceeding?",',
  '        { confirmLabel: language === "ar" ? "حفظ" : "Save", cancelLabel: language === "ar" ? "تجاهل" : "Discard" }',
  '      );',
  '      if (wantToSave) {',
  '        const success = await saveInlineEdit();',
  '        if (!success) return; // if save failed or hit delay prompt, abort switch',
  '      }',
  '    }',
  '    setSelectedAppointment(apt);',
  '  };',
  '',
];

// Remove lines 334 to 539 (0-indexed 333 to 538) and insert the fix
lines.splice(333, 538 - 333 + 1, ...fixedLines);

content = lines.join('\n');
fs.writeFileSync('src/components/dashboard/DesktopDashboard.tsx', content);
console.log("\nAfter fix, total lines:", content.split('\n').length);

// Verify
const newLines = content.split('\n');
console.log("Line 334:", JSON.stringify(newLines[333]));
console.log("Line 340:", JSON.stringify(newLines[339]));
console.log("Line 345:", JSON.stringify(newLines[344]));
console.log("Line 350:", JSON.stringify(newLines[349]));
