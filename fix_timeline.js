const fs = require('fs');

const file = 'src/components/dashboard/DesktopDashboard.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Fix ampm translation
const targetAMPM = `const ampm = h >= 12 ? 'PM' : 'AM';`;
const replacementAMPM = `const ampm = h >= 12 ? (language === 'ar' ? 'م' : 'PM') : (language === 'ar' ? 'ص' : 'AM');`;
content = content.replace(targetAMPM, replacementAMPM);

// 2. Fix RTL start/end for timeline labels and card container
// Note: we replaced this in the previous step to the new font-bold one:
const targetTimelineLabel = `className="absolute left-6 md:left-8 top-0 -translate-y-1/2 bg-white/40 backdrop-blur-md px-3 py-0.5 text-xs font-bold text-slate-900 group-hover/slot:text-black transition-colors z-0 w-[96px] text-center rounded-full border border-white shadow-sm"`;
const replacementTimelineLabel = "className={`absolute start-6 md:start-8 bg-white/40 backdrop-blur-md px-3 py-0.5 text-xs font-bold text-slate-900 group-hover/slot:text-black transition-colors z-0 w-[96px] text-center rounded-full border border-white shadow-sm ${idx === 0 ? 'top-3' : 'top-0 -translate-y-1/2'}`}";
content = content.replace(targetTimelineLabel, replacementTimelineLabel);

const targetCardContainer = `className="absolute inset-0 left-[88px] md:left-[104px] right-2 md:right-4 pointer-events-none"`;
const replacementCardContainer = `className="absolute inset-0 start-[88px] md:start-[104px] end-2 md:end-4 pointer-events-none"`;
content = content.replace(targetCardContainer, replacementCardContainer);

// Also check for the label formatting to be Arabic-friendly if language is Arabic
const targetLabelFormat = `const label = \`\${h12.toString().padStart(2, '0')}:\${mins.toString().padStart(2, '0')} \${ampm}\`;`;
const replacementLabelFormat = `const label = language === 'ar' ? \`\${ampm} \${h12.toString().padStart(2, '0')}:\${mins.toString().padStart(2, '0')}\` : \`\${h12.toString().padStart(2, '0')}:\${mins.toString().padStart(2, '0')} \${ampm}\`;`;
content = content.replace(targetLabelFormat, replacementLabelFormat);

fs.writeFileSync(file, content, 'utf8');
console.log("DesktopDashboard timeline UI fixed.");
