const fs = require('fs');
const path = require('path');
const finalDir = 'D:/self/xiangmu/youhua/final/';

// Read final chapter file names for continuity check
const files = fs.readdirSync(finalDir).filter(f => f.endsWith('.txt'));

console.log('=== TASK C: 最终审查报告 (v2) ===\n');

for (const file of files.sort()) {
  const filepath = path.join(finalDir, file);
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  
  let issues = [];
  
  // 1. Check first and last lines for cross-chapter continuity
  const firstLine = lines[0] || '';
  const lastLine = lines[lines.length - 1] || '';
  
  // Check if chapter starts mid-sex (needs continuity)
  const midSexStarters = ['抽送', '插入', '挺动', '龟头', '肉棒', '阳物'];
  for (const word of midSexStarters) {
    if (firstLine.includes(word) && !file.includes('chapter_1')) {
      issues.push('[连续性] 章节以性事中间开始，需确认有接续上一章的动作衔接');
      break;
    }
  }
  
  // Check if chapter ends mid-sex (needs retreat)
  const midSexEnders = ['抽送', '挺动', '抽插', '插入', '龟头'];
  for (const word of midSexEnders) {
    if (lastLine.includes(word)) {
      issues.push('[连续性] 章节以性事中间结束，缺少退潮反应（至少2句）');
      break;
    }
  }
  
  // 2. Check for forbidden elements (permanent body mutilation as erotic stimulation)
  const forbiddenTerms = ['疤痕的刺激', '断肢', '残缺的肉体'];
  for (const term of forbiddenTerms) {
    if (content.includes(term)) {
      issues.push('[违禁] 永久性身体残缺描写: ' + term);
    }
  }
  
  // 3. Check for "像/如/仿佛" metaphor sentences (only allowed in impaired consciousness)
  // Count occurrences - flag only if > 3
  const metaphorMatches = content.match(/[。！？\n][^。！？\n]*[像如仿佛]((?!像|如|仿佛)[^。！？]){0,15}[。！？\n]/g);
  const metaphorCount = metaphorMatches ? metaphorMatches.length : 0;
  if (metaphorCount > 3) {
    issues.push('[修辞] 比喻句超过3处（' + metaphorCount + '处），需确认角色是否处于意识模糊状态');
  }
  
  // 4. Real sentence length check (exclude decorative lines)
  const realSentences = content.split(/[。！？\n]/).filter(s => {
    const clean = s.replace(/[\s\u3000=#─\-]/g, '');
    return clean.length > 0 && !clean.match(/^[=#─\-]+$/);
  });
  const longRealSentences = realSentences.filter(s => {
    const clean = s.replace(/[\s\u3000]/g, '');
    return clean.length > 30;
  });
  if (longRealSentences.length > 5) {
    issues.push('[句式] 超过30字的长句: ' + longRealSentences.length + '处');
    issues.push('  例: "' + longRealSentences[0].replace(/[\s\u3000]/g, '').substring(0, 40) + '..."');
  }
  
  // 5. Check for multi-person pronoun issues (two+ characters but using only 他/她)
  const maleRefs = content.match(/他/g);
  const femaleRefs = content.match(/她/g);
  // Flag if total pronouns very high without name references nearby
  const nameRefs = content.match(/月儿|芙儿|钟郎|师姐|师兄|蛮王|唐宇|唐霓|公主/g);
  const pronounCount = (maleRefs ? maleRefs.length : 0) + (femaleRefs ? femaleRefs.length : 0);
  const nameCount = nameRefs ? nameRefs.length : 0;
  if (pronounCount > 50 && nameCount < 10) {
    issues.push('[代词] 代词使用过多（' + pronounCount + '次）但角色名仅' + nameCount + '次，多人场景可能混淆');
  }
  
  // 6. Check total word count
  const chineseChars = content.replace(/[\s\u3000a-zA-Z0-9-=#───┃━│\n\r]/g, '').length;
  
  // Print results
  console.log(file + ' (' + chineseChars + '字)');
  if (issues.length === 0) {
    console.log('  ✓ 通过');
  } else {
    for (const issue of issues) {
      console.log('  ' + issue);
    }
  }
  console.log('');
}

console.log('=== 审查完成 ===');
console.log('审查标准:');
console.log('1. 连续性: 跨章性爱断点检查');
console.log('2. 违禁元素: 永久性身体残缺用于性刺激');
console.log('3. 比喻句: 超过3处需确认');
console.log('4. 长句: 超过30字的多处存在');
console.log('5. 代词密度: 多人场景可能混淆');
