const fs = require('fs');
const path = require('path');

const finalDir = 'D:/self/xiangmu/youhua/final/';
const lexiconPath = 'D:/self/xiangmu/youhua/project_lexicon.txt';

// Read lexicon
const lexContent = fs.readFileSync(lexiconPath, 'utf-8');
const lexLines = lexContent.split('\n');

const allTerms = new Set();
const termCategories = {};

for (const line of lexLines) {
  const match = line.match(/^(\S+)\s*:\s*(\S+)\s*\|(.+)/);
  if (match) {
    const category = match[1].trim();
    const primary = match[2].trim();
    const alternatives = match[3].split(/[、,，]/).map(s => s.trim());
    termCategories[category] = { primary, all: [primary, ...alternatives] };
    allTerms.add(primary);
    alternatives.forEach(a => allTerms.add(a));
  }
}

console.log('Loaded', allTerms.size, 'terms from lexicon');

// Get all final files (also include files without "final" in name if they're chapter outputs)
const allFiles = fs.readdirSync(finalDir).filter(f => 
  f.endsWith('.txt')
);
console.log('\n=== Scanning', allFiles.length, 'files ===\n');

const results = {};

for (const file of allFiles.sort()) {
  const filepath = path.join(finalDir, file);
  const content = fs.readFileSync(filepath, 'utf-8');
  const fileResults = {
    forbiddenElements: [],
    multiTermViolations: [],
    sentenceLengthIssues: [],
    tooMuchConnective: false,
    totalChars: content.length,
  };

  // 1. Check forbidden elements: permanent body mutilation for erotic stimulation
  const forbiddenPatterns = [
    /疤痕.*[刺激淫欲爱抚舔]/g,
    /断肢.*[刺激淫欲爱抚舔]/g,
    /残缺.*[刺激淫欲]/g,
    /截肢/g,
  ];
  for (const pat of forbiddenPatterns) {
    let m;
    while ((m = pat.exec(content)) !== null) {
      fileResults.forbiddenElements.push(m[0]);
    }
  }

  // 2. Check multi-term usage per category
  for (const [cat, terms] of Object.entries(termCategories)) {
    const found = [];
    for (const term of terms.all) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      let count = 0;
      while (regex.exec(content) !== null) count++;
      if (count > 0) found.push({ term, count });
    }
    if (found.length > 1) {
      fileResults.multiTermViolations.push({
        category: cat,
        message: found.map(t => t.term + '(' + t.count + '次)').join(', ')
      });
    }
  }

  // 3. Check sentence length > 25 chars (Chinese characters)
  const sentences = content.split(/[。！？\n]/);
  const longSentences = sentences.filter(s => {
    const clean = s.replace(/[\s\u3000]/g, '');
    return clean.length > 25 && clean.length > 0;
  });
  fileResults.sentenceLengthIssues = longSentences.slice(0, 5).map(s => 
    s.replace(/[\s\u3000]/g, '').substring(0, 50)
  );

  // 4. Check connective words frequency
  const connectiveMap = {};
  for (const w of ['而', '但', '却', '于是']) {
    const regex = new RegExp(w, 'g');
    let count = 0;
    while (regex.exec(content) !== null) count++;
    connectiveMap[w] = count;
  }
  fileResults.connectiveStats = connectiveMap;

  // 5. Erotic density
  let eroticTermCount = 0;
  for (const term of allTerms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    while (regex.exec(content) !== null) eroticTermCount++;
  }
  fileResults.eroticDensity = (eroticTermCount / Math.max(content.length, 1) * 1000).toFixed(2);
  
  results[file] = fileResults;

  // Summary
  console.log('--- ' + file + ' (' + content.length + ' chars) ---');
  console.log('  Erotic density: ' + fileResults.eroticDensity + ' terms/1K chars');
  
  let hasIssue = false;
  if (fileResults.multiTermViolations.length > 0) {
    hasIssue = true;
    console.log('  [ISSUE] Multi-term violations:');
    for (const v of fileResults.multiTermViolations) {
      console.log('    - [' + v.category + ']: ' + v.message);
    }
  }
  if (fileResults.forbiddenElements.length > 0) {
    hasIssue = true;
    console.log('  [ISSUE] Forbidden elements: ' + fileResults.forbiddenElements.join(', '));
  }
  if (fileResults.sentenceLengthIssues.length > 3) {
    hasIssue = true;
    console.log('  [ISSUE] ' + fileResults.sentenceLengthIssues.length + ' long sentences (>25 chars)');
    console.log('    Examples: ' + fileResults.sentenceLengthIssues.slice(0, 2).map(s => s.substring(0, 40)).join(' | '));
  }
  
  const totalConnective = Object.values(fileResults.connectiveStats).reduce((a, b) => a + b, 0);
  if (totalConnective > 100) {
    hasIssue = true;
    console.log('  [NOTE] High connective word count: ' + totalConnective);
  }
  
  if (!hasIssue) {
    console.log('  [OK] Passed all checks');
  }
}

console.log('\n\n=== REVIEW SUMMARY ===');
console.log('Total files checked:', allFiles.length);
let issueCount = 0;
for (const [f, r] of Object.entries(results)) {
  if (r.multiTermViolations.length > 0 || r.forbiddenElements.length > 0 || r.sentenceLengthIssues.length > 3) {
    issueCount++;
    console.log('  NEEDS FIX: ' + f);
  }
}
console.log('Files needing attention: ' + issueCount + '/' + allFiles.length);
