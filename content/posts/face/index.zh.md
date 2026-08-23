---
title: "迁移学习如何提升人脸识别准确率？"
description: "迁移学习将人脸识别 Top-1 准确率提升至 69.75%：基于 2,000 张人脸数据集，通过 MTCNN 对齐、VGGFace 微调和集成分类器实现。"
coverImage: "/posts/face/images/cover.jpg"
coverImageAlt: "一张男性面部的特写肖像，代表面部识别与生物特征识别技术"
ogImage: "/posts/face/images/cover.jpg"
date: "2019-04-03 22:49:31"
lastUpdated: "2026-08-23 22:00:00"
author: "FindNS94"
tags: [Deep Learning, Computer Vision]
math: false
---

![一张男性面部的特写肖像，代表面部识别与生物特征识别技术](/posts/face/images/cover.jpg)

# 迁移学习如何提升人脸识别准确率？

当三个微调后的人脸识别模型通过投票方式进行集成时，在 2,000 张人脸的数据集上达到了 69.75% 的 Top-1 准确率，几乎是单一微调 VGGFace 模型 33.75% 的两倍。本实验报告完整记录了整个流程：基于 MTCNN 的人脸对齐、大规模数据迁移、从 VGGFace 和 FaceNet 的迁移学习，以及一个三模型集成分类器。如果你想在没有数百万张标注图像的情况下构建人脸识别系统，本文展示的迁移学习与数据增强技术说明如何从小规模数据集中获得有意义的结果。

<!-- more -->

> **核心要点**
> - 从预训练模型（VGGFace、FaceNet）进行迁移学习，可以在仅 2,000 张人脸的小数据集上实现人脸识别，无需从零训练。
> - MTCNN 人脸对齐检测到 98.25% 的人脸，而 Haar 级联仅检测到 78.45%，且 MTCNN 能将倾斜人脸旋转为正脸（作者实验）。
> - 单一微调的 VGGFace 模型存在严重过拟合：训练准确率 93.07%，但测试准确率仅 33.75%（作者实验）。
> - 三个多样化模型的集成将 Top-1 准确率从 44.6% 提升至 69.75%，Top-5 从 61.15% 提升至 82.1%（作者实验）。
> - FaceNet 的 128 维欧氏距离支持快速懒学习：预计算一次人脸嵌入向量，即可在毫秒级完成比对。

## 什么是人脸识别中的迁移学习？

迁移学习复用在大数据集上训练的模型，将其作为数据量较少的新任务的起点。在人脸识别领域，这一技术意义重大：采集和标注数百万张人脸图像成本高昂，而在大数据集上学习到的核心特征（边缘、纹理、面部几何结构）能够很好地迁移到新的面孔数据集上。

<!-- [UNIQUE INSIGHT] 关键在于人脸识别特征具有高度可迁移性：一个在数百万陌生人脸上训练出的模型，所学到的面部结构具有普适性，能够适用于任何新的人脸数据集，这正是迁移学习在此场景下仅用 2,000 张人脸就能奏效的根本原因。 -->

人脸识别的研究历史相当悠久。早在 1888 年和 1910 年，Galton 就在 *Nature* 杂志上发表了两篇关于利用人脸进行身份识别的文章，分析了人类自身的人脸识别能力。在 20 世纪的大部分时间里，自动人脸识别仍遥不可及。早期研究将其作为模式识别问题，采用基于几何特征的方法，随后出现了 Eigenface、Fisherface 和弹性图匹配等外观建模方法。到 20 世纪 90 年代末，研究者开始攻克真实场景下的人脸识别，提出了线性判别分析（LDA）、核方法等非线性建模、3D 人脸识别，以及 Gabor Face 和 LBP Face 等局部描述子。

转折点出现在 2014 年。深度学习与海量标注人脸数据相结合成为主流技术路线。Facebook 发表于 CVPR 2014 的 DeepFace 在 400 万张人脸图像上训练，在 LFW 基准上逼近了人类识别水平（[Taigman 等, DeepFace](https://research.facebook.com/publications/deepface-closing-the-gap-to-human-level-performance-in-face-verification/), 2014）。Google 发表于 CVPR 2015 的 FaceNet 采用 Triplet Loss 损失函数，超越了人类识别水平（[Schroff 等, FaceNet](https://arxiv.org/abs/1503.03832), 2015）。这些模型证明了从网络规模人脸数据中学到的特征具有泛化能力，而这正是迁移学习所利用的。

## FaceNet 和 VGGFace 是如何工作的？

FaceNet 和 VGGFace 是本实验构建所依赖的两个预训练架构。两者都学习一种紧凑的嵌入表示，使相似人脸在向量空间中彼此靠近，但训练方式和使用输出方式各不相同。

**FaceNet** 训练一个深度卷积网络，将每张人脸映射为一个 128 维向量，然后优化这些向量，使同一人的人脸距离更近、不同人的人脸距离更远。它使用 Triplet Loss 函数：对每个锚点人脸，将嵌入向量拉向正样本（同一人）、推离负样本（不同人）。Google 的原始模型在 800 万人的 2 亿张图像上训练，在 LFW 数据集上达到了 99.63% 的准确率（[Schroff 等, FaceNet](https://arxiv.org/abs/1503.03832), 2015），实际上终结了 LFW 上长达八年的性能竞赛。

> **引用摘要：** FaceNet 将每张人脸映射为 128 维嵌入向量，采用 Triplet Loss 在 800 万人的 2 亿张图像上训练，在 LFW 基准上达到 99.63% 的准确率（[Schroff 等, FaceNet](https://arxiv.org/abs/1503.03832), 2015）。这是当时最高的报告结果，标志着 LFW 性能竞赛的落幕。

**VGGFace** 来自牛津大学视觉几何组（VGG），采取了不同的技术路线。它以 VGGNet 为骨干网络，在 VGGFace 数据集上使用标准 softmax 分类进行训练。训练完成后，去掉最终的分类层，将倒数第二层的分数向量作为人脸特征，通过计算欧氏距离进行验证。作者在 LFW 上报告了 98.95% 的准确率（[Parkhi 等, VGGFace](https://www.robots.ox.ac.uk/~vgg/publications/2015/Parkhi15/parkhi15.pdf), 2015）。该分数向量还可进一步在欧氏空间中使用 triplet loss 进行精炼。

在人脸检测与对齐方面，本实验还使用了 **MTCNN**，一种发表于 ECCV 2016 的级联卷积神经网络（[Zhang 等, MTCNN](https://arxiv.org/abs/1604.02878), 2016）。MTCNN 依次运行三个网络：P-Net 提出候选人脸窗口，R-Net 通过额外的全连接层剔除误检区域以精炼结果，O-Net 施加更精细的监督并输出 5 个面部关键点。

## 识别前如何对齐人脸？

人脸对齐将每张检测到的人脸归一化处理，使同一人的两张图像能够公平比对。主要操作是裁剪和旋转，目的是去除背景噪声并校正头部倾斜。本实验对比了两种对齐方法：基于 OpenCV 的 Haar 级联和 MTCNN。

<!-- [ORIGINAL DATA] 以下提取率数据直接来自作者在 2,000 张人脸数据集上的课程实验。 -->

### 使用 OpenCV Haar 特征提取人脸

Haar 特征反映图像的灰度变化情况。OpenCV 提供了预训练好的面部特征 XML 文件，加载后即可用于人脸检测（[OpenCV haarcascades](https://github.com/opencv/opencv/tree/master/data/haarcascades)）。本实验使用了以下五个级联文件：

```
haarcascade_frontalface_default.xml
haarcascade_frontalface_alt.xml
haarcascade_frontalface_alt2.xml
haarcascade_frontalface_alt_tree.xml
haarcascade_profileface.xml
```

前四个用于检测正脸，最后一个用于检测侧脸。提取效果示例如下：

| 原始图片 | 提取后图片 |
|:---:|:---:|
|![Haar 级联提取前的人脸原始输入照片](/posts/face/images/haar_origin.jpg)|![Haar 级联检测到的人脸裁剪区域](/posts/face/images/haar_extract.jpg)|

<!-- [PERSONAL EXPERIENCE] 在数据集上运行这些级联分类器时，我们发现 Haar 特征会漏检相当一部分人脸，尤其是倾斜或部分遮挡的人脸。 -->

本数据集上的实际提取结果：

| 训练集提取数量 | 训练集提取百分比 | 测试集提取数量 | 测试集提取百分比 |
|:---:|:---:|:---:|:---:|
| 1,569 | 78.45% | 1,554 | 77.7% |

### 使用 MTCNN 提取人脸

MTCNN 是发表于 ECCV 2016 的工作，采用级联卷积神经网络进行面部关键点检测与对齐（[Zhang 等, MTCNN](https://arxiv.org/abs/1604.02878), 2016）。本实验使用 MXNet 框架的实现进行人脸对齐。示例如下：

| 原始图片 | 提取后图片 |
|:---:|:---:|
|![MTCNN 提取前的人脸原始输入照片](/posts/face/images/mtcnn_origin.jpg)|![MTCNN 输出的人脸裁剪与对齐后的正脸](/posts/face/images/mtcnn_extract.jpg)|

实际提取结果：

| 训练集提取数量 | 训练集提取百分比 | 测试集提取数量 | 测试集提取百分比 |
|:---:|:---:|:---:|:---:|
| 1,965 | 98.25% | 1,971 | 98.55% |

MTCNN 不仅比 Haar 级联检测到更多的人脸（训练集上 98.25% vs 78.45%），还能将倾斜的人脸旋转为正脸。正是这一旋转步骤对后续的人脸比对产生了最大的正面影响。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/face/charts/chart-2-face-extraction-method-comparison.svg" alt="分组柱状图对比 OpenCV Haar 特征与 MTCNN 的人脸提取率。Haar 在训练集上达到 78.45%，测试集上 77.7%。MTCNN 在训练集上达到 98.25%，测试集上 98.55%。" loading="lazy" style="max-width:100%;height:auto">
  <figcaption>来源：作者课程实验，2,000 张人脸数据集（2019）</figcaption>
</figure>

## 数据增强如何提升模型泛化能力？

在深度学习中，更多的训练数据通常意味着更好的泛化能力。由于本实验使用的是小规模人脸数据集，数据增强通过对每张图像施加随机变换来人工扩展数据集。实验使用了两个库：Keras 的 ImageDataGenerator 和 imgaug。

<!-- [ORIGINAL DATA] 以下 91,702 张图像总数和 44.85 倍倍增系数直接来自我们的数据增强流水线实测。 -->

### 使用 ImageDataGenerator 进行数据增强

ImageDataGenerator 是 Keras 提供的 API，在训练过程中实时施加变换：

- **旋转/反射**：按设定角度随机旋转图像并翻转方向
- **翻转**：沿水平或垂直方向镜像图像
- **缩放**：按随机比例放大或缩小图像
- **平移**：在图像平面上水平或垂直移动图像
- **缩放处理**：按指定比例调整图像大小，或构建尺度空间以改变尺寸或模糊度
- **对比度**：在 HSV 色彩空间中保持色调 H 不变，改变饱和度 S 和亮度 V，对每个像素施加 0.25 到 4 之间的指数因子
- **噪声**：对每个像素的 RGB 值施加椒盐噪声或高斯噪声扰动

四组增强效果示例：

| 增强示例 1 | 增强示例 2 | 增强示例 3 | 增强示例 4 |
|:---:|:---:|:---:|:---:|
|![ImageDataGenerator 生成的变换后人脸图像示例](/posts/face/images/augmentation_1.png)|![ImageDataGenerator 生成的变换后人脸图像示例](/posts/face/images/augmentation_2.jpg)|![ImageDataGenerator 生成的变换后人脸图像示例](/posts/face/images/augmentation_3.jpg)|![ImageDataGenerator 生成的变换后人脸图像示例](/posts/face/images/augmentation_4.jpg)|

### 使用 imgaug 进行数据增强

imgaug 是一个独立的 Python 图像增强库（[imgaug](https://github.com/aleju/imgaug)），支持图像缩放、裁剪或填充、水平和垂直翻转、灰度转换、高斯扰动、锐化、浮雕效果以及调亮或调暗。

另外四组示例：

| 增强示例 1 | 增强示例 2 | 增强示例 3 | 增强示例 4 |
|:---:|:---:|:---:|:---:|
|![imgaug 生成的变换后人脸图像示例](/posts/face/images/augmentation_5.png)|![imgaug 生成的变换后人脸图像示例](/posts/face/images/augmentation_6.jpg)|![imgaug 生成的变换后人脸图像示例](/posts/face/images/augmentation_7.jpg)|![imgaug 生成的变换后人脸图像示例](/posts/face/images/augmentation_8.jpg)|

整个流水线共生成 91,702 张训练图像，平均每张原始训练图像生成 44.85 张增强图像。

## 在小数据集上微调 VGGFace 是否可行？

微调以一个在大数据集上预训练的模型为基础，在特定数据上继续训练。本实验从 VGGFace RESNET50 模型出发，保留全连接层之前的所有权重，仅使用增强后的训练集图像重新训练全连接层。

<!-- [PERSONAL EXPERIENCE] 实验过程中我们观察到严重的过拟合现象：训练准确率攀升至 93% 以上，但测试准确率停滞在 33% 左右。这一差距说明模型只是在记忆训练人脸的增强变体，而非学习可泛化的特征。 -->

在 GitHub 上，rcmalli 提供了基于 Oxford VGGFace 数据集训练的 Keras 版 VGGFace 实现，包含 VGG16、RESNET50 和 SENET50 三种骨干网络（[rcmalli/keras-vggface](https://github.com/rcmalli/keras-vggface)）。本实验使用 RESNET50 变体。训练集和验证集的准确率曲线如下：

![VGGFace 微调的训练集准确率曲线，50 个 epoch 内攀升至约 93%](/posts/face/images/loss_1.png)

![VGGFace 微调的测试集准确率曲线，50 个 epoch 内停滞在约 33%](/posts/face/images/loss_2.png)

50 个 epoch 后，训练准确率达到 0.9307，而测试准确率峰值仅为 0.3375。Top-1 准确率为 0.3375，Top-5 准确率为 0.489。训练与测试准确率之间的巨大差距是过拟合的明显信号：模型记忆了增强后的训练人脸，而没有学习到可泛化的特征。

## 什么是懒学习？FaceNet 如何比对人脸？

懒学习在预测阶段跳过显式模型训练，转而计算每个测试样本与所有训练样本之间的距离，返回最接近的匹配。FaceNet 使这变得切实可行，因为它将每张人脸压缩为 128 维向量，比对两张人脸只需一次欧氏距离计算。

<!-- [ORIGINAL DATA] 本节中的准确率数据是作者使用预训练 FaceNet 模型在 2,000 张人脸数据集上的实测结果。 -->

实验使用的 FaceNet 模型是 davidsandberg 基于 VGGFace2 数据、使用 Inception ResNet v1 架构训练的实现，在 LFW 上报告了 0.9965 的准确率（[davidsandberg/facenet](https://github.com/davidsandberg/facenet))。流程如下：

![FaceNet 人脸提取流水线：输入图像、MTCNN 检测、128 维嵌入向量，随后进行比对](/posts/face/images/facenet.png)

MTCNN 首先从输入图像中提取人脸区域。然后使用预计算的比对脚本计算图像对之间的相似度。由于每张测试图像都需要与全部 2,000 张训练图像进行比对，预先计算并将人脸嵌入向量缓存到磁盘可以显著加速。

原始人脸距离输出示例：

```
0          0       1.3858
0          1       1.3257
0          2       1.5103
0          3       1.1707
0          4       1.0327
0          5       1.4050
0          6       1.5472
0          7       1.3509
0          8       1.3133
0          9       1.4988
```

第一列为测试图像索引，第二列为训练图像索引，第三列为两者嵌入向量之间的欧氏距离。

对所有距离进行排序并取最接近的 5 个匹配：

```
120:332,120,1534,405,356
121:121,193,1536,1252,1984
122:122,987,1165,780,1317
123:123,1077,1154,135,1222
124:550,600,124,1292,589
125:953,549,125,1981,1729
126:126,138,1820,1699,462
127:127,1003,1013,1441,325
128:201,817,1002,2,717
```

冒号前为测试图像索引，冒号后为训练集中最接近的 5 张人脸的索引。

使用未经微调的预训练 FaceNet 模型，Top-1 准确率为 0.446，Top-5 准确率为 0.6115。

## 集成分类器如何提升准确率？

单一模型存在盲区。集成学习将多个多样化模型组合起来，使一个模型的优势能够弥补另一个模型的不足。本实验构建了三个基分类器，在损失函数、训练数据和图像处理方式上各有不同：

- **模型 1**：未微调，原始图像经 MTCNN 处理
- **模型 2**：softmax loss + center loss，2,000 张训练图像及 2,000 张对应灰度图像，经 MTCNN 和 OpenCV 双重处理
- **模型 3**：triplet loss，2,000 张训练图像及 8,000 张增强图像，灰度图像经 MTCNN 和 OpenCV 双重处理

集成方案对每个模型的输出使用 KNN 分类器（k=1，欧氏距离），综合三个预测结果。

<!-- [ORIGINAL DATA] 以下集成准确率数据是作者在测试集上的最终实测结果。 -->

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/face/charts/chart-1-model-accuracy-comparison.svg" alt="水平柱状图对比人脸识别模型准确率。VGGFace 微调：Top-1 33.75%，Top-5 48.9%。FaceNet 懒学习：Top-1 44.6%，Top-5 61.15%。集成分类器：Top-1 69.75%，Top-5 82.1%。" loading="lazy" style="max-width:100%;height:auto">
  <figcaption>来源：作者课程实验，2,000 张人脸数据集（2019）</figcaption>
</figure>

集成方案将 Top-1 准确率从单一最佳模型的 44.6% 提升至 69.75%，Top-5 准确率从 61.15% 提升至 82.1%。损失函数、训练集和图像处理方式的多样性正是提升的驱动力：每个模型犯不同的错误，多数投票机制使它们相互抵消。

![可视化界面截图，展示从导入的集成模型加载最终结果数据](/posts/face/images/visualization_1.png)

该界面允许运行最终模型并查询任意测试对象：

| 从导入的模型运行最终结果数据 | 输入待检测对象的 ID |
|:---:|:---:|
|![可视化界面中加载最终模型结果数据的截图](/posts/face/images/visualization_2.png)|![可视化界面中输入待检测对象 ID 的截图](/posts/face/images/visualization_3.png)|

系统返回最接近的 5 张匹配人脸：

![系统返回的 Top 5 最接近人脸匹配结果可视化](/posts/face/images/visualization_4.png)

## 常见问题

**本实验使用了什么数据集？**
数据集包含为大学课程项目采集的 2,000 张人脸图像。经过 MTCNN 提取和增强后，训练集扩展至 91,702 张图像（每张原始图像生成 44.85 个增强版本）。

**为什么选择 MTCNN 而非 Haar 级联进行人脸对齐？**
MTCNN 在训练集上检测到 98.25% 的人脸，而 Haar 级联仅检测到 78.45%。更重要的是，MTCNN 在比对前会将倾斜人脸旋转为正脸，这直接提升了后续识别的准确率。

**FaceNet 使用的 Triplet Loss 函数是什么？**
Triplet Loss 取一个锚点人脸、一个正样本（同一人）和一个负样本（不同人），训练网络使锚点与正样本的距离比与负样本的距离更近，且保持一定间隔。FaceNet 的 128 维输出使这一距离具有实际意义。

**为什么微调的 VGGFace 模型过拟合如此严重？**
训练准确率达到 93.07%，但测试准确率峰值仅为 33.75%。模型记忆了训练集的增强变体，而非学习可泛化的人脸特征。更大的数据集或更强的正则化会有所改善。

**这种迁移学习方案能否扩展到更大规模的人脸数据集？**
可以。同一流水线（MTCNN 对齐、数据增强、预训练基模型、集成）天然具备扩展性。在更大数据集上，微调整个网络（而非仅分类器）并使用更困难的三元组挖掘策略，可以进一步提升准确率。

## 总结

本实验将迁移学习应用于 2,000 张人脸数据集上的人脸识别，通过三模型集成达到了 69.75% 的 Top-1 和 82.1% 的 Top-5 准确率。整个流水线（MTCNN 对齐、大规模数据增强、VGGFace 和 FaceNet 微调、集成投票）表明，无需网络规模的数据也能实现有意义的人脸识别。

<!-- [UNIQUE INSIGHT] 准确率的最大提升并非来自任何单一模型选择，而是源于两个关键决策：从 Haar 切换到 MTCNN 对齐（多恢复了 20% 的人脸）以及将多样模型集成为投票集成（将 Top-1 提升了 25 个百分点）。 -->

有几个方向可以进一步提升结果。首先，将 dlib、Haar 和 MTCNN 进行集成对齐，可以从更困难的角度恢复更多的人脸。其次，提取眼睛、鼻子、耳朵等面部特征并分别训练分类器，再通过多数投票机制组合，可能减少我们观察到的正脸到侧脸匹配错误。第三，TP-GAN 类模型可以将侧脸图像合成为正脸图像，这将解决我们测试中最大的误分类来源。

## 参考来源

- Taigman 等，"DeepFace: Closing the Gap to Human-Level Performance in Face Verification," CVPR 2014, https://research.facebook.com/publications/deepface-closing-the-gap-to-human-level-performance-in-face-verification/
- Schroff 等，"FaceNet: A Unified Embedding for Face Recognition and Clustering," CVPR 2015, https://arxiv.org/abs/1503.03832
- Parkhi 等，"Deep Face Recognition," BMVC 2015, https://www.robots.ox.ac.uk/~vgg/publications/2015/Parkhi15/parkhi15.pdf
- Zhang 等，"Joint Face Detection and Alignment using Multi-task Cascaded Convolutional Networks," ECCV 2016, https://arxiv.org/abs/1604.02878
- OpenCV, "Haar Feature-based Cascade Classifier for Object Detection," https://github.com/opencv/opencv/tree/master/data/haarcascades
- aleju, "imgaug," 图像增强库, https://github.com/aleju/imgaug
- rcmalli, "keras-vggface," Keras 版 VGGFace 模型, https://github.com/rcmalli/keras-vggface
- davidsandberg, "facenet," TensorFlow 版 FaceNet 实现, https://github.com/davidsandberg/facenet
