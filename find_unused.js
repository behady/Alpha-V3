const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, fileList);
    } else {
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
        fileList.push(filePath);
      }
    }
  }
  return fileList;
}

const allFiles = getAllFiles(srcDir);

// Build a map of file exports and check who imports them
// For simplicity, we just look at the filename without extension,
// e.g., "FinanceModal" and check if the string "FinanceModal" or "./FinanceModal" is present in ANY other file.

const fileUsage = {};
allFiles.forEach(f => fileUsage[f] = 0);

allFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  allFiles.forEach(targetFile => {
    if (file === targetFile) return;
    const baseName = path.basename(targetFile, path.extname(targetFile));
    // If it's index.tsx, we check the folder name
    let searchNames = [baseName];
    if (baseName === 'index' || baseName === 'page' || baseName === 'layout' || baseName === 'route') {
      const folderName = path.basename(path.dirname(targetFile));
      searchNames.push(folderName);
    }
    
    // Quick heuristic: does the content import the baseName?
    searchNames.forEach(name => {
      // Ignore very common short names to avoid false positives
      if (name.length > 3) {
        if (content.includes(name)) {
          fileUsage[targetFile]++;
        }
      }
    });
  });
});

const unusedFiles = allFiles.filter(f => {
  const baseName = path.basename(f, path.extname(f));
  // Exclude Next.js entry points
  if (['page', 'layout', 'route', 'globals'].includes(baseName)) return false;
  // Exclude root components if they are the entry
  if (baseName === 'layout' || baseName === 'page') return false;
  
  return fileUsage[f] === 0;
});

console.log(JSON.stringify(unusedFiles, null, 2));
