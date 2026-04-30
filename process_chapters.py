#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
小说章节处理脚本
Task A: 章节骨骼化
Task B: 色情场景扩写
"""

import os
import re
import sys

# 配置
INPUT_DIR = r"D:\self\xiangmu\youhua\chapters"
OUTPUT_DIR = r"D:\self\xiangmu\youhua\chapters_output"
LEXICON_FILE = r"D:\self\xiangmu\youhua\project_lexicon.md"
RULES_FILE = r"D:\self\xiangmu\youhua\全局写作规则.md"

# 色情关键词
EROTIC_KEYWORDS = ['亲吻', '爱抚', '舔舐', '插入', '抽送', '高潮', '射精', '口交', '自慰']
EROTIC_PATTERN = re.compile('|'.join(EROTIC_KEYWORDS))

# 情色前置关键词
FOREPLAY_KEYWORDS = ['脱衣', '解带', '裸露', '沐浴', '脱', '褪', '解', '裸', '洗', '禁锢', '亵裤', '肚兜', '中衣']
FOREPLAY_PATTERN = re.compile('|'.join(FOREPLAY_KEYWORDS))

# 需要删除的模式（世界观说明、背景描写）
WORLD_BUILDING_PATTERNS = [
    r'原来.*?是这样',
    r'据说.*?年前',
    r'新宋.*?制度',
    r'所谓.*?就是',
    r'指的是.*?',
    r'简而言之',
    r'一言以概之',
    r'《.*?》记载',
    r'据.*?记载',
    r'相传',
    r'这数百年来',
]

def ensure_output_dir():
    """确保输出目录存在"""
    os.makedirs(OUTPUT_DIR, exist_ok=True)

def load_lexicon():
    """加载词汇库供扩写使用"""
    with open(LEXICON_FILE, 'r', encoding='utf-8') as f:
        return f.read()

def load_rules():
    """加载全局规则"""
    with open(RULES_FILE, 'r', encoding='utf-8') as f:
        return f.read()

def read_chapter(chapter_num):
    """读取章节文件"""
    filepath = os.path.join(INPUT_DIR, f"chapter_{chapter_num:03d}.txt")
    if not os.path.exists(filepath):
        return None
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()

def is_erotic_paragraph(text):
    """判断段落是否包含色情内容"""
    return bool(EROTIC_PATTERN.search(text))

def has_foreplay_keywords(text):
    """判断段落是否包含情色前置关键词"""
    return bool(FOREPLAY_PATTERN.search(text))

def is_world_building(text):
    """判断是否为世界观说明"""
    for pattern in WORLD_BUILDING_PATTERNS:
        if re.search(pattern, text):
            # 检查是否也包含色情内容
            if not is_erotic_paragraph(text) and not has_foreplay_keywords(text):
                return True
    return False

def is_relationship_change(text):
    """判断是否为人物关系变化且为色情场景提供动机"""
    relationship_patterns = [
        r'嫁', r'娶', r'平婚', r'订婚', r'蓝颜', r'平夫', r'正夫',
        r'成为.*?妻子', r'成为.*?相公', r'爱上了', r'动心', r'钟情',
        r'献身', r'肉身布施', r'元红', r'初夜', r'第一次',
    ]
    has_relationship = any(re.search(p, text) for p in relationship_patterns)
    has_erotic = is_erotic_paragraph(text) or has_foreplay_keywords(text)
    return has_relationship and has_erotic

def is_plot_turning(text):
    """判断是否为剧情转折句"""
    plot_patterns = [
        r'突然', r'没想到', r'原来', r'发现', r'得知', r'决定',
        r'计划', r'安排', r'任务', r'差事', r'告诉', r'知道',
        r'后来', r'从此', r'终于', r'最后',
    ]
    return any(re.search(p, text) for p in plot_patterns)

def should_keep_paragraph(text, next_text=""):
    """判断段落是否应该保留"""
    # 色情内容必须保留
    if is_erotic_paragraph(text):
        return True, 'erotic'
    
    # 情色前置保留
    if has_foreplay_keywords(text):
        return True, 'foreplay'
    
    # 人物关系变化为色情提供动机的保留
    if is_relationship_change(text):
        return True, 'relationship'
    
    # 剧情转折保留一句
    if is_plot_turning(text) and len(text) < 100:
        return True, 'plot'
    
    # 世界观说明删除
    if is_world_building(text):
        return False, 'world_building'
    
    # 超过100字的非色情段落压缩
    if len(text) > 100:
        return True, 'compressed'
    
    # 短的非色情段落，如果是叙事性且连接剧情则保留
    if len(text) < 100 and not is_world_building(text):
        return True, 'keep_short'
    
    return False, 'delete'

def compress_paragraph(text):
    """压缩非色情段落为一句话"""
    # 取第一句或主要意思
    sentences = re.split(r'[。！？]', text)
    if sentences:
        main_sentence = sentences[0].strip()
        if len(main_sentence) > 80:
            # 进一步压缩
            main_sentence = main_sentence[:80] + '……'
        return main_sentence + '。'
    return ''

def task_a_skeletonize(chapter_text, chapter_num):
    """Task A: 章节骨骼化"""
    lines = chapter_text.split('\n')
    result_lines = []
    erotic_count = 0
    in_erotic_scene = False
    erotic_scene_start_saved = False
    
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        
        # 保留章节标题
        if re.match(r'^第[零一二三四五六七八九十百千]+章', line):
            result_lines.append(line)
            result_lines.append('')
            continue
        
        should_keep, reason = should_keep_paragraph(line)
        
        if should_keep:
            if reason == 'erotic':
                erotic_count += 1
                if not erotic_scene_start_saved:
                    # 保存色情场景起点句
                    first_sentence = re.split(r'[。！？]', line)[0]
                    result_lines.append(f'[情色锚点] {first_sentence}。')
                    erotic_scene_start_saved = True
                else:
                    result_lines.append(line)
                in_erotic_scene = True
            elif reason == 'foreplay':
                # Extract foreplay description
                sentences = re.split(r'[。！？]', line)
                foreplay_sentences = [s for s in sentences if FOREPLAY_PATTERN.search(s)]
                if foreplay_sentences:
                    result_lines.append(f'[情色前置] {"。".join(foreplay_sentences)}。')
                erotic_scene_start_saved = True
                in_erotic_scene = True
            elif reason == 'compressed':
                compressed = compress_paragraph(line)
                if compressed:
                    result_lines.append(compressed)
            elif reason == 'relationship':
                # 保留一句说明
                sentences = re.split(r'[。！？]', line)
                if sentences:
                    result_lines.append(sentences[0].strip() + '。')
            elif reason == 'plot':
                result_lines.append(line)
            elif reason == 'keep_short':
                result_lines.append(line)
        else:
            if in_erotic_scene and not is_world_building(line):
                result_lines.append(f'[场景过渡] {compress_paragraph(line)}')
            # 否则删除
    
    return '\n'.join(result_lines)

def task_b_expand_simple(skeleton_text, chapter_num):
    """Task B: 简单版色情场景扩写"""
    lines = skeleton_text.split('\n')
    result_lines = []
    
    for line in lines:
        line = line.strip()
        if not line:
            result_lines.append('')
            continue
        
        # 检测情色锚点，进行扩写
        if line.startswith('[情色锚点]'):
            anchor_text = line.replace('[情色锚点] ', '')
            expansion = expand_erotic_scene(anchor_text)
            result_lines.append(expansion)
        elif line.startswith('[情色前置]'):
            foreplay_text = line.replace('[情色前置] ', '')
            expansion = expand_foreplay_scene(foreplay_text)
            result_lines.append(expansion)
        else:
            result_lines.append(line)
    
    return '\n'.join(result_lines)

def expand_erotic_scene(anchor_text):
    """扩写情色锚点场景"""
    expansion_parts = []
    
    # 1. 保留原锚点句
    expansion_parts.append(f'【情色场景开始】{anchor_text}')
    
    # 2. 从关键词判断场景类型，添加扩写
    if any(kw in anchor_text for kw in ['吻', '亲', '唇', '舌']):
        expansion_parts.append(
            '他的唇覆上她的，舌尖撬开贝齿，'
            '轻轻探入她温热的口腔中。'
            '她的香舌羞涩地回应，与他纠缠在一起，'
            '唇齿间溢出香甜的津液。'
            '她感觉到他舌头的温热与力度，'
            '身子不由自主地软了下来。'
        )
    
    if any(kw in anchor_text for kw in ['脱', '解', '露', '裸', '衣', '衫', '裙']):
        expansion_parts.append(
            '他伸手解开她的衣带，'
            '外衫顺着肩头滑落，'
            '露出里面薄如蝉翼的中衣。'
            '他的指尖在她锁骨处流连，'
            '感受着她肌肤的细腻与温热。'
        )
    
    if any(kw in anchor_text for kw in ['摸', '抚', '揉', '按', '胸', '乳', '峰']):
        expansion_parts.append(
            '他的手掌覆上她胸前饱满的柔软，'
            '隔着薄薄的布料轻轻揉捏。'
            '她娇躯一颤，喉间溢出一声低吟，'
            '乳头在他的抚弄下渐渐硬挺。'
        )
    
    if any(kw in anchor_text for kw in ['插', '进', '入', '肏', '干']):
        expansion_parts.append(
            '他挺起粗大的鸡巴，'
            '龟头抵住她湿滑的肉穴口，'
            '腰身一沉，缓缓顶入。'
            '她"啊"地一声娇叫，'
            '肉壁被撑开的饱胀感让她浑身痉挛，'
            '淫水顺着交合处淌下。'
        )
    
    if any(kw in anchor_text for kw in ['抽', '送', '动']):
        expansion_parts.append(
            '他开始有节奏地抽送，'
            '龟头每一次都撞在她花心深处，'
            '激得她浪叫连连。'
            '淫水被肉棒带出，发出咕叽咕叽的水声，'
            '两人的交合处一片湿滑。'
        )
    
    if any(kw in anchor_text for kw in ['射', '精', '高潮', '丢']):
        expansion_parts.append(
            '他猛地加速冲刺，'
            '龟头狠狠顶入她子宫口，'
            '浓白的精液激射而出，'
            '烫得她娇躯剧颤，'
            '花心一阵痉挛，也跟着泄了身。'
        )
    
    return '\n\n'.join(expansion_parts)

def expand_foreplay_scene(foreplay_text):
    """扩写情色前置场景"""
    expansions = {
        '脱': '他指尖勾住她的衣带，轻轻一拉，罗裳缓缓滑落，露出雪腻的香肩与精致的锁骨。',
        '解': '他灵巧地解开她腰间的系带，薄纱般的衣衫如云雾般散开，露出内里春光。',
        '露': '衣衫褪去，她莹白如玉的胴体逐渐展露，烛光下泛着温润的光泽。',
        '裸': '她完全赤裸地站在他面前，肌肤如新剥荔枝般晶莹剔透，曲线玲珑。',
        '洗': '温热的水流滑过她光滑的肌肤，水珠顺着锁骨淌下，滑过乳沟，滴入水中。',
        '亵裤': '那条薄如蝉翼的亵裤紧贴着她的肌肤，勾勒出大腿至小腹间迷人的曲线。',
        '肚兜': '海棠红的肚兜紧裹着她的肉峰，饱满如新剥荔枝，随着呼吸轻轻起伏。',
    }
    
    result_parts = [f'【情色前置场景】{foreplay_text}']
    
    for keyword, expansion in expansions.items():
        if keyword in foreplay_text:
            result_parts.append(expansion)
    
    return '\n\n'.join(result_parts)

def process_chapter(chapter_num):
    """处理单个章节"""
    print(f"正在处理第{chapter_num}章...")
    
    # 读取章节
    text = read_chapter(chapter_num)
    if text is None:
        print(f"  -> 第{chapter_num}章文件不存在，跳过")
        return False
    
    # Task A: 骨骼化
    skeleton = task_a_skeletonize(text, chapter_num)
    
    # Task B: 扩写
    expanded = task_b_expand_simple(skeleton, chapter_num)
    
    # 写入输出
    output_file = os.path.join(OUTPUT_DIR, f"chapter_{chapter_num:03d}_final.md")
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(f"# 第{chinese_number(chapter_num)}章（处理版）\n\n")
        f.write("---\n\n")
        f.write("## Task A: 章节骨骼化\n\n")
        f.write(skeleton)
        f.write("\n\n---\n\n")
        f.write("## Task B: 色情场景扩写\n\n")
        f.write(expanded)
    
    print(f"  -> 完成！输出: {output_file}")
    return True

def chinese_number(n):
    """阿拉伯数字转中文数字"""
    num_map = {
        19: '十九', 20: '二十', 21: '二十一', 22: '二十二',
        23: '二十三', 24: '二十四', 25: '二十五', 26: '二十六',
        27: '二十七', 28: '二十八', 29: '二十九', 30: '三十',
        31: '三十一', 32: '三十二', 33: '三十三', 34: '三十四',
        35: '三十五', 36: '三十六', 37: '三十七', 38: '三十八',
        39: '三十九', 40: '四十',
    }
    return num_map.get(n, str(n))

def main():
    print("=" * 60)
    print("《贞心淫骨》章节处理工具")
    print("Task A: 章节骨骼化")
    print("Task B: 色情场景扩写")
    print("=" * 60)
    
    ensure_output_dir()
    
    # 处理第19-40章
    chapters_to_process = list(range(19, 41))
    success_count = 0
    fail_count = 0
    
    for ch in chapters_to_process:
        result = process_chapter(ch)
        if result:
            success_count += 1
        else:
            fail_count += 1
    
    print("\n" + "=" * 60)
    print(f"处理完成！成功: {success_count} 章, 跳过: {fail_count} 章")
    print(f"输出目录: {OUTPUT_DIR}")
    print("=" * 60)

if __name__ == "__main__":
    main()
