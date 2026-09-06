# 查找重复图片指南

## Context

在博客开发过程中，封面图（cover.jpg）可能因为以下原因出现重复：
- 从同一来源下载了相同的图片
- 不同文章使用了相似的默认图片
- 压缩或缩放后文件不同但内容相同

重复封面图影响博客美观和专业性。本文档介绍如何检测和修复重复图片。

---

## 检测方法

### 为什么 MD5 不够？

MD5 哈希只能检测**完全相同**的文件。如果两张图片：
- 尺寸不同（640×427 vs 600×399）
- 压缩质量不同（q=85 vs q=70）
- 格式不同（JPEG vs PNG）

它们的 MD5 值会不同，但**视觉内容完全相同**。需要使用**感知哈希**（Perceptual Hash）来检测。

### 感知哈希原理

感知哈希将图片转换为固定长度的二进制字符串（哈希值），相似图片的哈希值相似：

1. **缩放到固定尺寸**（如 16×16）消除尺寸差异
2. **转为灰度图**消除颜色差异
3. **计算像素平均值**
4. **生成二进制哈希**：每个像素 > 平均值为 1，否则为 0

两张图片的哈希值差异（汉明距离）越小，内容越相似。

---

## 检测脚本

### 脚本位置

`scripts/find_similar_images.py`

### 使用方法

```bash
# 默认参数检测 public/posts 目录
python3 scripts/find_similar_images.py

# 指定目录和阈值
python3 scripts/find_similar_images.py public/posts 10 10

# 参数说明：
#   参数1: 搜索目录（默认 public/posts）
#   参数2: MSE 阈值（默认 10，越小越严格）
#   参数3: 哈希汉明距离阈值（默认 10，越小越严格）
```

### 脚本输出

```
Found 298 images in public/posts
Thresholds: MSE < 10.0, hash distance < 10

=== EXACT DUPLICATES (15 pairs) ===
  MSE=0.3, hash_diff=0
    public/posts/linux-eevdf-scheduler/images/cover.jpg (66KB)
    public/posts/linux-packet-journey/images/cover.jpg (89KB)

=== SIMILAR IMAGES (2 pairs) ===
  MSE=246.0, hash_diff=1
    public/posts/sitting_posture/images/input.png
    public/posts/sitting_posture/images/mark_pixel.png
```

### 结果解读

| 类别 | 说明 | 处理建议 |
|------|------|----------|
| **EXACT DUPLICATES** | MSE < 10 且哈希差异 < 10 | 必须替换，内容完全相同 |
| **SIMILAR IMAGES** | 哈希差异小但 MSE 较大 | 检查是否为相似但不相同的图片 |

---

## 仅检测封面图

如果只想检测 `cover.jpg` 的重复：

```python
import os
from PIL import Image

def avg_hash(img, hash_size=16):
    img = img.resize((hash_size, hash_size)).convert('L')
    pixels = list(img.getdata())
    avg = sum(pixels) / len(pixels)
    return ''.join('1' if p > avg else '0' for p in pixels)

covers = []
for root, dirs, files in os.walk('public/posts'):
    for f in files:
        if f.lower() == 'cover.jpg':
            covers.append(os.path.join(root, f))

hashes = {}
for path in covers:
    img = Image.open(path)
    h = avg_hash(img)
    if h in hashes:
        print(f"DUPLICATE:")
        print(f"  {hashes[h]}")
        print(f"  {path}")
    else:
        hashes[h] = path

print(f"\nTotal: {len(covers)}, Unique: {len(hashes)}")
```

---

## 修复重复图片

### 替换步骤

1. **识别重复组**：运行检测脚本获取重复列表
2. **选择保留项**：每组保留一个（通常是文件路径更"正确"的那个）
3. **下载新图片**：从 [Pixabay](https://pixabay.com) 或 [Unsplash](https://unsplash.com) 下载主题相关的图片
4. **压缩到 100KB 以下**：使用本文档后面的压缩脚本
5. **验证唯一性**：再次运行检测脚本确认无重复

### 下载新封面图示例

```bash
# 从 Pixabay 下载（免费，无需署名）
curl -sL -o public/posts/<slug>/images/cover.jpg "https://cdn.pixabay.com/photo/..."

# 从 Unsplash 下载（免费，无需署名）
curl -sL -o public/posts/<slug>/images/cover.jpg "https://images.unsplash.com/photo-...?w=640&h=427&fit=crop"
```

### 注意事项

- 新图片必须与文章主题相关
- 避免使用已在其他封面图中使用的图片
- 压缩后再次检查唯一性（不同来源的图片压缩后哈希值可能偶然相近）

---

## 压缩脚本

所有图片必须压缩到 **100KB 以下**。使用以下 Python 脚本：

```python
from PIL import Image
from io import BytesIO
import os

TARGET_SIZE = 100 * 1024  # 100KB
JPEG_QUALITIES = [85, 80, 75, 70, 65, 60, 55, 50]
COVER_MAX_W = 1200
INLINE_MAX_W = 800

def compress_image(path):
    img = Image.open(path)
    is_cover = os.path.basename(path).lower() == 'cover.jpg'
    max_w = COVER_MAX_W if is_cover else INLINE_MAX_W

    # Convert to RGB for JPEG
    if img.mode in ('RGBA', 'LA', 'P'):
        bg = Image.new('RGB', img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1] if img.mode != 'P' else None)
        img = bg
    elif img.mode != 'RGB':
        img = img.convert('RGB')

    orig_size = os.path.getsize(path)
    if orig_size < TARGET_SIZE:
        return  # Already small enough

    # Resize if too wide
    if img.width > max_w:
        ratio = max_w / img.width
        img = img.resize((max_w, int(img.height * ratio)), Image.LANCZOS)

    # Find quality that gets us under 100KB
    for q in JPEG_QUALITIES:
        buf = BytesIO()
        img.save(buf, 'JPEG', quality=q, optimize=True)
        if buf.tell() < TARGET_SIZE:
            with open(path, 'wb') as f:
                f.write(buf.getvalue())
            return

    # If still too large, shrink further to 600px
    if img.width > 600:
        ratio = 600 / img.width
        img = img.resize((600, int(img.height * ratio)), Image.LANCZOS)
        for q in JPEG_QUALITIES:
            buf = BytesIO()
            img.save(buf, 'JPEG', quality=q, optimize=True)
            if buf.tell() < TARGET_SIZE:
                with open(path, 'wb') as f:
                    f.write(buf.getvalue())
                return
```

### 批量压缩

```bash
# 查找所有超过 100KB 的图片
find public/posts -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" \) -size +99k

# 运行压缩脚本
python3 << 'PYEOF'
# ... (粘贴上面的脚本)
for root, dirs, files in os.walk('public/posts'):
    for f in files:
        if f.lower().endswith(('.jpg', '.jpeg')):
            compress_image(os.path.join(root, f))
PYEOF
```

---

## 验证清单

在完成图片替换后，执行以下检查：

```bash
# 1. 检查是否还有重复
python3 scripts/find_similar_images.py public/posts 10 10

# 2. 检查是否还有超过 100KB 的图片
find public/posts -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" \) -size +99k

# 3. 检查封面图唯一性
python3 -c "
import os
from PIL import Image

def avg_hash(img, hash_size=16):
    img = img.resize((hash_size, hash_size)).convert('L')
    pixels = list(img.getdata())
    avg = sum(pixels) / len(pixels)
    return ''.join('1' if p > avg else '0' for p in pixels)

covers = []
for root, dirs, files in os.walk('public/posts'):
    for f in files:
        if f.lower() == 'cover.jpg':
            covers.append(os.path.join(root, f))

hashes = {}
for path in covers:
    img = Image.open(path)
    h = avg_hash(img)
    hashes.setdefault(h, []).append(path)

dupes = {h: paths for h, paths in hashes.items() if len(paths) > 1}
if dupes:
    print(f'Found {len(dupes)} duplicate groups')
    for h, paths in dupes.items():
        print(f'  {paths}')
else:
    print(f'All {len(covers)} covers are unique!')
"

# 4. 构建验证
pnpm build
```

---

## 参考资料

- [Pixabay](https://pixabay.com) — 免费图片，无需署名
- [Unsplash](https://unsplash.com) — 免费图片，无需署名
- [Pexels](https://pexels.com) — 免费图片，无需署名
- [ImageMagick](https://imagemagick.org) — 命令行图片处理工具
- [Pillow](https://python-pillow.org) — Python 图片处理库
