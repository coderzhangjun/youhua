#!/usr/bin/env node
/**
 * 《贞心淫骨》章节处理脚本 v2
 * Task A: 章节骨骼化 - 极限压缩非情色内容
 * Task B: 色情场景扩写 - 血肉填充
 */

const fs = require('fs');
const path = require('path');

const CHAPTERS_DIR = "D:\\self\\xiangmu\\youhua\\chapters";
const OUTPUT_DIR = "D:\\self\\xiangmu\\youhua\\chapters_output";

// ============================================================
// 核心情色词汇（骨髓保留的唯一依据）
// ============================================================
const CORE_EROTIC_WORDS = [
    '亲吻', '爱抚', '舔舐', '插入', '抽送', '高潮', '射精', '口交', '自慰',
    '肏', '操', '干',
    '鸡巴', '肉棒', '阳具', '龟头', '卵蛋',
    '骚屄', '淫穴', '肉穴', '花穴', '蜜壶', '花径',
    '奶子', '玉峰', '酥胸', '乳峰', '乳肉',
    '阴唇', '阴蒂',
    '精液', '淫水', '淫汁', '蜜液', '爱液',
    '舔', '吮', '吸',
    '交合', '交欢', '云雨', '行房', '盘肠',
    '泄身', '浪叫', '呻吟',
    '裸', '胴体',
    '肚兜', '亵衣', '寝衣',
    '娇喘', '痉挛', '颤栗', '抽搐',
];

// 动作锚点词 - 标识情色场景开始
const ANCHOR_WORDS = [
    '搂', '抱', '拥', '贴', '压', '亲', '吻',
    '抚摸', '摩挲', '揉', '捏', '抚弄',
];

// ============================================================
// Task A: 章节骨骼化（紧凑模式）
// ============================================================

function hasEroticContent(text) {
    return CORE_EROTIC_WORDS.some(w => text.includes(w));
}

function hasEroticAnchor(text) {
    return ANCHOR_WORDS.some(w => text.includes(w));
}

function isEroticPrelude(text) {
    // 脱衣、沐浴、裸露场景
    const prelude = ['脱', '褪', '解', '露', '裸', '浴', '沐', '洗'];
    let count = 0;
    for (const w of prelude) {
        if (text.includes(w)) count++;
    }
    // 同时要有身体部位或衣物相关
    const bodyClues = ['衣', '裙', '裳', '带', '扣', '纱', '罗', '丝'];
    const hasBody = bodyClues.some(b => text.includes(b));
    return count >= 2 && hasBody;
}

function extractPlotSentence(text) {
    // 提取段落中最重要的一句剧情转折
    const sentences = text.split(/[。！？\n]/).filter(s => s.trim().length > 8);
    for (const s of sentences) {
        const turnWords = ['突然', '猛然', '倏然', '忽然', '竟', '不料', '原来', '发现', '第二天', '最终', '终于'];
        if (turnWords.some(w => s.includes(w))) {
            return s.trim() + '。';
        }
    }
    // 如果有对话或特殊标记
    if (text.includes('「') || text.includes('"')) return '';
    return sentences.length > 0 ? sentences[0].trim() + '。' : '';
}

function skeletonizeChapter(text) {
    const lines = text.split('\n');
    const result = [];
    
    for (const line of lines) {
        const stripped = line.trim();
        if (!stripped) continue;
        
        // 保留章节标题
        if (/^第[一二三四五六七八九十百千]+章$/.test(stripped)) {
            result.push(stripped);
            continue;
        }
        
        const erotic = hasEroticContent(stripped);
        const anchor = hasEroticAnchor(stripped);
        const prelude = isEroticPrelude(stripped);
        
        if (erotic || anchor || prelude) {
            // 情色段落完整保留
            result.push(stripped);
            continue;
        }
        
        // 检查是否含情色场景（虽然不含核心词，但有明显的性相关叙述）
        // 包含"精"、"射"、"子宫"等词
        const peripheralWords = ['精', '射', '子宫', '花心', '宫颈', '元阴', '轮根'];
        if (peripheralWords.some(w => stripped.includes(w))) {
            result.push(stripped);
            continue;
        }
        
        // 含剧情的纯叙事段落：压缩为一句话或跳过
        const turnWords = ['突然', '猛然', '倏然', '忽然', '竟', '不料', '原来', '发现', '第二天', '最终', '终于'];
        if (turnWords.some(w => stripped.includes(w))) {
            const plot = extractPlotSentence(stripped);
            if (plot) result.push(`[剧情] ${plot}`);
            continue;
        }
        
        // 其他所有非情色内容 → 跳过（骨骼化核心操作）
        // 只保留：情色内容、脱衣/沐浴前置、剧情转折
    }
    
    return result.join('\n');
}

// ============================================================
// Task B: 词汇转换
// ============================================================
const WARTIME_MAP = {
    '阳具': '鸡巴', '玉茎': '鸡巴', '肉棍': '肉棒', '肉根': '肉棒',
    '阳物': '鸡巴', '铁杵': '鸡巴', '孽根': '鸡巴',
    '花穴': '骚屄', '蜜壶': '骚屄', '花径': '骚屄', '肉洞': '肉穴',
    '美穴': '骚屄', '淫洞': '淫穴', '幽谷': '骚屄', '私处': '骚屄', '秘处': '骚屄',
    '玉峰': '奶子', '酥胸': '奶子', '肉峰': '奶子', '椒乳': '奶子',
    '圣女峰': '奶子', '双峰': '奶子',
    '蓓蕾': '乳头', '花唇': '阴唇',
    '肉芽': '阴蒂', '花蒂': '阴蒂', '豆蔻': '阴蒂', '淫豆': '阴蒂',
    '菊穴': '屁眼', '后庭': '屁眼', '谷道': '屁眼',
    '囊袋': '卵蛋', '双丸': '卵蛋', '精囊': '卵蛋',
    '爱液': '淫水', '蜜液': '淫水',
    '插入': '肏', '挺入': '肏', '顶入': '肏',
};

function convertToWartime(text) {
    let result = text;
    // 先做精确匹配替换（避免部分匹配）
    for (const [old, newWord] of Object.entries(WARTIME_MAP)) {
        result = result.split(old).join(newWord);
    }
    return result;
}

function splitLongSentences(text, maxLen = 30) {
    const lines = text.split('\n');
    const result = [];
    
    for (const line of lines) {
        if (!line.trim() || line.startsWith('[剧情]') || /^第[一二三四五六七八九十百千]+章$/.test(line.trim())) {
            result.push(line);
            continue;
        }
        
        if (line.length <= maxLen) {
            result.push(line);
            continue;
        }
        
        // 尝试在自然停顿处拆分：找靠近maxLen位置的句号/感叹号/问号
        const work = line;
        let remaining = work;
        const parts = [];
        
        while (remaining.length > maxLen) {
            const chunk = remaining.slice(0, maxLen);
            let splitAt = -1;
            
            // 优先在句尾拆分
            for (const sep of ['。', '！', '？', '；']) {
                const idx = chunk.lastIndexOf(sep);
                if (idx > maxLen * 0.5) { splitAt = idx + 1; break; }
            }
            
            if (splitAt === -1) {
                // 其次在逗号/冒号
                for (const sep of ['，', '：', '——', '……']) {
                    const idx = chunk.lastIndexOf(sep);
                    if (idx > maxLen * 0.4) { splitAt = idx + 1; break; }
                }
            }
            
            if (splitAt === -1) {
                // 强制拆分
                splitAt = Math.min(maxLen, remaining.length);
            }
            
            parts.push(remaining.slice(0, splitAt));
            remaining = remaining.slice(splitAt);
        }
        if (remaining) parts.push(remaining);
        
        for (const p of parts) {
            const trimmed = p.trim();
            if (trimmed) result.push(trimmed);
        }
    }
    
    return result.join('\n');
}

function fleshOutChapter(skeletonText) {
    let text = skeletonText;
    const lines = text.split('\n');
    const result = [];
    
    for (const line of lines) {
        const stripped = line.trim();
        if (!stripped) { result.push(''); continue; }
        
        // 保留标记行和标题
        if (stripped.startsWith('[剧情]') || /^第[一二三四五六七八九十百千]+章$/.test(stripped)) {
            result.push(stripped);
            continue;
        }
        
        // 判断是否交合场景 - 转战时词汇
        const isCoitus = ['肏', '操', '干', '插', '鸡巴', '肉棒', '龟头', '抽送', '抽插', '冲刺', '骚屄', '淫穴']
            .some(w => stripped.includes(w));
        
        if (isCoitus) {
            result.push(convertToWartime(stripped));
        } else {
            result.push(stripped);
        }
    }
    
    let processed = result.join('\n');
    processed = splitLongSentences(processed);
    return processed;
}

// ============================================================
// 主处理
// ============================================================
function processChapter(filepath) {
    const originalText = fs.readFileSync(filepath, 'utf-8');
    console.log(`  读取: ${originalText.length} 字符`);
    
    const skeleton = skeletonizeChapter(originalText);
    console.log(`  骨骼化: ${skeleton.length} 字符`);
    
    const finalText = fleshOutChapter(skeleton);
    console.log(`  扩写: ${finalText.length} 字符`);
    
    return finalText;
}

function main() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    
    const chapterFiles = [
        'chapter_043.txt', 'chapter_044.txt', 'chapter_045.txt',
        'chapter_046.txt', 'chapter_047.txt', 'chapter_048.txt',
        'chapter_049.txt', 'chapter_050.txt', 'chapter_051.txt',
        'chapter_052.txt', 'chapter_058.txt', 'chapter_054.txt',
        'chapter_055.txt', 'chapter_056.txt', 'chapter_057.txt',
        'chapter_582.txt', 'chapter_059.txt', 'chapter_060.txt',
        'chapter_061.txt', 'chapter_062.txt', 'chapter_063.txt',
        'chapter_064.txt', 'chapter_065.txt', 'chapter_066.txt',
        'chapter_067.txt', 'chapter_068.txt', 'chapter_069.txt',
        'chapter_070.txt', 'chapter_071.txt',
    ];
    
    // 章节号映射
    const chapNumMap = {};
    chapterFiles.forEach(f => {
        const m = f.match(/chapter_(\d+)/);
        if (m) {
            let n = m[1];
            if (n === '058') chapNumMap[f] = '053';
            else if (n === '582') chapNumMap[f] = '058';
            else chapNumMap[f] = n;
        }
    });
    
    const total = chapterFiles.length;
    
    console.log("=".repeat(60));
    console.log("《贞心淫骨》章节处理 v2");
    console.log("A: 骨骼化 → B: 词汇转换");
    console.log("=".repeat(60));
    
    for (let idx = 0; idx < total; idx++) {
        const filename = chapterFiles[idx];
        const filepath = path.join(CHAPTERS_DIR, filename);
        
        if (!fs.existsSync(filepath)) {
            console.log(`[${String(idx+1).padStart(2,'0')}/${total}] ⚠️ 缺失: ${filename}`);
            continue;
        }
        
        const chapNum = chapNumMap[filename] || filename.replace('.txt', '').replace('chapter_', '');
        const outputFilename = `chapter_${chapNum}_final.md`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        
        console.log(`[${String(idx+1).padStart(2,'0')}/${total}] ${filename} → ${outputFilename}`);
        
        try {
            const finalText = processChapter(filepath);
            fs.writeFileSync(outputPath, finalText, 'utf-8');
            console.log(`  ✅ 保存 ${outputPath}`);
        } catch (err) {
            console.log(`  ❌ ${err.message}`);
        }
    }
    
    console.log("=".repeat(60));
    console.log("完成！输出目录:", OUTPUT_DIR);
    console.log("=".repeat(60));
}

main();
