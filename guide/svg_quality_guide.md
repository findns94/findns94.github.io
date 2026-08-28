# SVG 质量保障指南

本文档总结了博客图表 SVG 在生成、验证和修复过程中的经验教训，旨在建立系统化的 SVG 质量保障流程。

---

## 一、问题类型分类

### 1.1 几何计算错误

#### 饼图/环形图百分比不等于 100%
- **症状：** 扇形之间有间隙或重叠
- **根因：** `stroke-dasharray` 的弧长总和不等于圆周长（2πr），或多个圆形叠加时浮点精度累积导致间隙
- **正确做法：** 使用 `<path>` 元素绘制扇形（推荐）
  ```xml
  <!-- 推荐：使用 path 元素绘制扇形，确保完美拼接 -->
  <path d="M x1 y1 A R R 0 large-arc 1 x2 y2 L x3 y3 A r r 0 large-arc 0 x4 y4 Z"
        fill="#color" />
  ```
- **公式：**
  - 圆周长 = 2 × π × 半径
  - 外弧端点：`x = cx + R×sin(θ)`, `y = cy - R×cos(θ)`
  - 内弧端点：`x = cx + r×sin(θ)`, `y = cy - r×cos(θ)`
  - θ 从顶部（12 点方向）顺时针测量
- **注意：** `stroke-dasharray` 方法即使弧长计算正确，多个圆形叠加时仍可能因渲染精度产生间隙

#### 柱状图基线未对齐
- **症状：** 负值柱形"飘在空中"，不从 0% 基线开始
- **根因：** 负值柱形的 `y` 坐标计算错误
- **正确做法：**
  ```xml
  <!-- 错误：柱形顶部在基线下方 -->
  <rect y="218.9" height="81.1" ... />  <!-- 从 y=218.9 到 y=300 -->

  <!-- 正确：柱形从基线开始向下延伸 -->
  <rect y="195" height="141.1" ... />  <!-- 从基线 y=195 开始 -->
  ```
- **规则：**
  - 正值柱形：`y = 基线 - height`，`height = 值 × 比例`
  - 负值柱形：`y = 基线`，`height = |值| × 比例`

#### 饼图扇形坐标计算错误
- **症状：** 扇形溢出圆形边界或形状不协调
- **根因：** 使用 `<path>` 绘制时，弧线端点坐标不在圆周上
- **正确做法：** 使用三角函数精确计算端点：
  ```
  x = cx + r × sin(θ)
  y = cy - r × cos(θ)
  ```
  其中 θ 从顶部（12 点方向）顺时针测量

### 1.2 文字遮挡/重叠

#### 文字与图形重叠
- **症状：** 文字被矩形、圆形或其他图形遮挡
- **根因：** 文字位置与图形位置重叠，或绘制顺序错误
- **修复：** 调整文字位置或绘制顺序

#### 文字超出边界
- **症状：** 文字被裁剪或超出可视区域
- **根因：** 文字 x/y 坐标超出 viewBox 范围
- **修复：** 增加边距或移动文字位置

#### 文字与图形间距过近
- **症状：** 文字与椭圆、矩形等图形距离太近，视觉拥挤
- **根因：** 间距不足
- **修复：** 增大间距（建议至少 20px）

### 1.3 颜色问题

#### 颜色重复
- **症状：** 饼图中相似颜色出现多次，难以区分
- **根因：** 使用了相似的颜色（如 amber #f59e0b 和 orange #f97316）
- **修复：** 使用高对比度颜色，确保每个类别颜色唯一

---

## 二、验证方法

### 2.1 自动化验证

#### XML 有效性检查
```bash
xmllint --noout chart.svg && echo "VALID" || echo "BROKEN"
```

#### 饼图类型检测（Python）
```python
import re

def detect_pie_chart_type(svg_content):
    """检测饼图绘制方式"""
    paths = re.findall(r'<path[^>]*d="([^"]+)"', svg_content)
    circles = re.findall(r'<circle[^>]*stroke-dasharray="([\d.]+)\s+([\d.]+)"', svg_content)
    
    if paths:
        return "path"  # 推荐方式，无间隙
    elif circles:
        return "stroke-dasharray"  # 可能有间隙
    else:
        return "unknown"

def verify_pie_chart(svg_content):
    """验证饼图质量"""
    chart_type = detect_pie_chart_type(svg_content)
    
    if chart_type == "stroke-dasharray":
        # stroke-dasharray 方式可能有间隙，建议改用 path
        return False, "stroke-dasharray 方式可能有间隙，建议改用 path 元素"
    elif chart_type == "path":
        return True, "path 方式，无间隙"
    else:
        return True, "未检测到饼图"
```

#### 柱状图基线验证（Python）
```python
def verify_bar_baseline(svg_content):
    baselines = re.findall(r'<line[^>]*y1="(\d+)"[^>]*y2="\1"[^>]*>', svg_content)
    if not baselines:
        return True
    
    baseline_y = float(baselines[0])
    rects = re.findall(r'<rect[^>]*y="([\d.]+)"[^>]*>', svg_content)
    
    for y in rects:
        y = float(y)
        if y > baseline_y + 2:  # 负值柱形应从基线开始
            return False, f"bar at y={y} should start at baseline={baseline_y}"
    return True, "OK"
```

### 2.2 可视化验证

#### 转换为 PNG 检查
```bash
# 使用 rsvg-convert（推荐）
rsvg-convert -w 1200 chart.svg -o chart.png

# 或使用 Chromium 截图
```

#### 检查清单
- [ ] 饼图/环形图：所有扇形无间隙地填满整个圆
- [ ] 柱状图：负值柱形从基线开始向下延伸
- [ ] 文字：不被遮挡，不超出边界
- [ ] 颜色：每个类别颜色唯一且易区分
- [ ] 间距：文字与图形之间有足够间距

### 2.3 浏览器预览

在浏览器中直接打开 SVG 文件，检查：
- 各元素是否对齐
- 是否有溢出或间隙
- 文字是否正常显示
- 颜色是否正确

---

## 三、生成 SVG 的最佳实践

### 3.1 饼图/环形图

#### 使用 path 元素（推荐，无间隙）
```xml
<!-- 扇形路径公式（顺时针从 12 点方向测量） -->
<!-- M 外弧起点 -->
<!-- A 外弧终点（R=外半径） -->
<!-- L 内弧起点 -->
<!-- A 内弧终点（r=内半径） -->
<!-- Z 闭合 -->
<path d="M x1 y1 A R R 0 large-arc 1 x2 y2 L x3 y3 A r r 0 large-arc 0 x4 y4 Z"
      fill="#color" />
```

**坐标计算：**
```python
import math

def pie_slice_path(cx, cy, R, r, angle_start, angle_end):
    """生成扇形路径（角度顺时针从 12 点方向测量）"""
    a1 = math.radians(angle_start)
    a2 = math.radians(angle_end)

    # 外弧起点/终点
    x1 = cx + R * math.sin(a1)
    y1 = cy - R * math.cos(a1)
    x2 = cx + R * math.sin(a2)
    y2 = cy - R * math.cos(a2)

    # 内弧起点/终点
    x3 = cx + r * math.sin(a2)
    y3 = cy - r * math.cos(a2)
    x4 = cx + r * math.sin(a1)
    y4 = cy - r * math.cos(a1)

    # large-arc 标志（弧线 < 180° 为 0，≥ 180° 为 1）
    span = (angle_end - angle_start) % 360
    large_arc = 1 if span > 180 else 0

    return f"M {x1:.2f} {y1:.2f} A {R} {R} 0 {large_arc} 1 {x2:.2f} {y2:.2f} L {x3:.2f} {y3:.2f} A {r} {r} 0 {large_arc} 0 {x4:.2f} {y4:.2f} Z"
```

**示例（5 个扇形的环形图）：**
```xml
<g>
  <!-- 背景圆 -->
  <circle cx="260" cy="190" r="120" stroke="#grid" stroke-width="44" fill="none"/>
  <!-- 扇形 1：40%，-90° 到 54° -->
  <path d="M 140.00 190.00 A 120 120 0 0 1 357.08 119.47 L 321.49 145.33 A 76 76 0 0 0 184.00 190.00 Z" fill="#f97316"/>
  <!-- 扇形 2：15%，54° 到 108° -->
  <path d="M 357.08 119.47 A 120 120 0 0 1 374.13 227.08 L 332.28 213.49 A 76 76 0 0 0 321.49 145.33 Z" fill="#38bdf8"/>
  <!-- ... 更多扇形 ... -->
</g>
```

#### 使用 stroke-dasharray（不推荐，可能有间隙）
```xml
<!-- 警告：多个圆形叠加时可能因浮点精度产生间隙 -->
<!-- 圆周长 = 2 × π × r -->
<circle r="120" stroke="#color1" stroke-width="40"
        stroke-dasharray="301.6 753.98"    <!-- 弧长 圆周长 -->
        stroke-dashoffset="0"
        transform="rotate(-90)" />
```

### 3.2 柱状图

#### 垂直柱状图
```xml
<!-- 基线在 y=195 -->
<!-- 正值：从基线向上 -->
<rect y="96" width="40" height="99" ... />  <!-- y = 195 - 99 -->
<!-- 负值：从基线向下 -->
<rect y="195" width="40" height="141" ... />  <!-- y = 195 -->
```

#### 水平柱状图
```xml
<!-- 基线在 x=140 -->
<!-- 正值：从基线向右 -->
<rect x="140" y="90" width="150" height="22" ... />
<!-- 负值：从基线向左 -->
<rect x="-10" y="90" width="150" height="22" ... />
```

### 3.3 文字

#### 避免遮挡
- 文字与其他元素至少保持 20px 间距
- 文字放在图形上方（后绘制）
- 考虑添加半透明背景提高可读性

#### 避免超出边界
- 文字 x 坐标 ≥ 20（左边距）
- 文字 x 坐标 ≤ viewBox宽度 - 20（右边距）
- 文字 y 坐标 ≥ 30（上边距）
- 文字 y 坐标 ≤ viewBox高度 - 20（下边距）

---

## 四、常见错误速查表

| 错误 | 症状 | 修复 |
|------|------|------|
| stroke-dasharray 圆形叠加间隙 | 饼图扇形之间有可见间隙 | 改用 path 元素绘制 |
| 弧长总和 ≠ 圆周长 | 饼图有间隙/重叠 | 按比例缩放弧长 |
| 负值柱形 y > 基线 | 柱形飘在空中 | y = 基线 |
| 文字 x < 20 或 x > viewBox宽度-20 | 文字被裁剪 | 调整 x 坐标 |
| 文字与图形重叠 | 文字被遮挡 | 移动文字或图形 |
| 相似颜色重复 | 难以区分类别 | 使用高对比度颜色 |
| 弧线端点不在圆周上 | 扇形溢出 | 用三角函数计算坐标 |
| 中心文字颜色与扇区重复 | 视觉混乱 | 使用中性色（如灰色） |

---

## 五、质量检查清单

### 生成后立即检查
- [ ] `xmllint --noout` 通过
- [ ] 饼图/环形图：使用 path 元素绘制（无间隙）
- [ ] 柱状图：负值柱形从基线开始
- [ ] 文字：不被遮挡，不超出边界
- [ ] 颜色：每个类别颜色唯一，中心文字使用中性色

### 转换 PNG 后检查
- [ ] 各元素对齐正确
- [ ] 无溢出或间隙（特别注意饼图扇形之间）
- [ ] 文字清晰可读
- [ ] 颜色对比度足够
- [ ] 中心文字颜色不与任何扇区重复

### 浏览器预览检查
- [ ] 暗色/亮色主题下均正常
- [ ] 响应式缩放无变形
- [ ] 无水平/垂直滚动条

---

## 六、工具链

| 工具 | 用途 | 命令 |
|------|------|------|
| `xmllint` | XML 有效性检查 | `xmllint --noout chart.svg` |
| `rsvg-convert` | SVG → PNG 转换 | `rsvg-convert -w 1200 chart.svg -o chart.png` |
| `puppeteer` | 浏览器渲染截图 | 需要 Node.js |
| Python 脚本 | 几何计算验证 | 自定义脚本 |

---

## 七、修复案例

### 案例 1：饼图扇形间隙问题

**问题：** 使用 `stroke-dasharray` 绘制的饼图，扇形之间有可见间隙。

**根因：** 多个圆形叠加时，浮点精度累积导致渲染间隙。即使弧长计算正确，间隙仍然存在。

**修复前（stroke-dasharray）：**
```xml
<circle r="120" stroke="#f97316" stroke-width="44"
        stroke-dasharray="301.6 753.98" transform="rotate(-90)" />
<circle r="120" stroke="#38bdf8" stroke-width="44"
        stroke-dasharray="113.1 753.98" transform="rotate(-234)" />
<!-- ... 更多圆形 ... -->
```

**修复后（path 元素）：**
```xml
<path d="M 140.00 190.00 A 120 120 0 0 1 357.08 119.47 L 321.49 145.33 A 76 76 0 0 0 184.00 190.00 Z" fill="#f97316"/>
<path d="M 357.08 119.47 A 120 120 0 0 1 374.13 227.08 L 332.28 213.49 A 76 76 0 0 0 321.49 145.33 Z" fill="#38bdf8"/>
<!-- ... 更多 path ... -->
```

**效果：** 间隙消失，扇形完美拼接。

---

### 案例 2：柱状图基线未对齐

**问题：** 负值柱形"飘在空中"，不从 0% 基线开始。

**根因：** 负值柱形的 `y` 坐标计算错误。

**修复前：**
```xml
<rect y="218.9" width="40" height="81.1" ... />  <!-- 从 y=218.9 开始 -->
```

**修复后：**
```xml
<rect y="195" width="40" height="141.1" ... />  <!-- 从基线 y=195 开始 -->
```

---

### 案例 3：文字超出边界

**问题：** 图表右侧的文字标签被裁剪。

**根因：** 文字 x 坐标超出 viewBox 宽度。

**修复前：**
```xml
<text x="605" text-anchor="start" ...>Age 25: 8.5M</text>  <!-- 超出 viewBox 宽度 640 -->
```

**修复后：**
```xml
<text x="600" text-anchor="end" ...>Age 25: 8.5M</text>  <!-- 文字终点在 x=600 -->
```

---

### 案例 4：颜色重复

**问题：** 饼图中心文字颜色与某个扇区颜色相同，造成视觉混乱。

**根因：** 中心文字使用了扇区的颜色。

**修复前：**
```xml
<text fill="#f59e0b" ...>$500–1K</text>  <!-- 与 Camera 扇区颜色相同 -->
```

**修复后：**
```xml
<text fill="#22c55e" ...>$500–1K</text>  <!-- 使用不重复的颜色 -->
```

---

*文档创建时间: 2026-08-28*
*最后更新: 2026-08-28*
*基于 155 个 SVG 图表的检查和修复经验*
