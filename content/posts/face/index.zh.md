---
title: 人脸识别迁移学习
date: 2019-04-03 22:49:31
tags: [Deep Learning, Computer Vision]
categories: [Course]
math: true
---

人脸识别的研究历史相当悠久。早在 1888 年和 1910 年，Galton 就分别在 *Nature* 杂志上发表了两篇关于利用人脸进行身份识别的文章，对人类自身的人脸识别能力进行了分析。但当时人脸的自动识别问题还遥不可及。近年来，人脸识别研究吸引了众多研究者的关注，涌现出了多种技术方法。尤其是 1990 年以来，人脸识别取得了长足的发展。几乎所有知名的理工科大学和主要的 IT 公司都有研究组在从事相关研究。

在早期阶段，传统的人脸识别通常被作为一个一般性的模式识别问题来研究，所采用的主要技术方案是基于几何特征（Geometric feature based）的方法。这集中体现在对侧面轮廓（Profile）的研究上，研究者们围绕面部轮廓曲线的结构特征提取与分析开展了大量工作。随后，Eigenface、Fisherface 和弹性图匹配等基于表观的建模方法不断被提出。从 20 世纪 90 年代末开始，研究者开始关注面向真实场景的人脸识别问题，提出了不同的人脸空间模型，包括以线性判别分析（Linear Discriminant Analysis）为代表的线性建模方法、以核方法（Kernel-based methods）为代表的非线性建模方法，以及基于三维信息的 3D 人脸识别方法。新的特征表示也相继被提出，包括局部描述子（Gabor Face、LBP Face 等）和深度学习方法。

2014 年以来，深度学习 + 大数据（海量的有标注人脸数据）已成为人脸识别领域的主流技术路线，VGGFace、DeepFace、FaceNet 等深层神经网络不断被提出，人脸识别准确率也在持续提升。2014 年，Facebook 发表于 CVPR 2014 的工作 DeepFace 将大数据（400 万张人脸图像）与深度卷积网络相结合，在 LFW 数据集上逼近了人类的识别精度。2015 年，Google 发表于 CVPR 2015 的工作 FaceNet 采用 Triplet Loss 损失函数，在 LFW 数据集上超越了人类的识别精度。

<!-- more -->

# 相关工作

人脸识别任务中常用的数据集是 LFW 数据集，它是真实场景下人脸识别问题的一个测试基准。LFW 数据集包含从互联网收集的 5,749 人的 13,233 张人脸图像，其中 1,680 人拥有两张或以上的图像。LFW 的标准测试协议包含 6,000 对人脸的十折验证任务，每折包括 300 对正例和 300 对反例，以十折平均准确率作为性能评价指标。

Google 于 2015 年首次提出 FaceNet，在 LFW 数据集上取得了 99.63% 的十折平均准确率，是当时所有工作中最高的，几乎宣告了 LFW 上自 2008 年至 2015 年长达八年的性能竞赛的终结。FaceNet 采用了 22 层的深层卷积网络、海量的人脸数据（800 万人的 2 亿张图像）以及常用于图像检索任务的 Triplet Loss 损失函数。FaceNet 并未采用传统的 softmax 方式进行分类学习，而是去掉了 softmax 后的结构，经过 L2 归一化后得到特征表示，并在此基础上计算三元组损失。通过基于元组距离计算的方式进行模型训练，学到的图像表示极为紧致——仅需 128 维即可表示一张人脸。

VGGFace 由牛津大学视觉几何组（Visual Geometry Group）于 2015 年提出。他们采用 VGGNet 作为网络架构，网络的最后一层为分类器 (W, b)，分类误差通过 softmax log-loss 计算。学习过程完成后，可以移除分类器 (W, b)，将分数向量 φ(lt) 作为特征，通过计算欧氏距离进行人脸验证。上述分数向量还可以进一步通过在欧氏空间中使用"triplet loss"进行训练来加以改进。VGGFace 最终在 LFW 数据集上取得了 98.95% 的准确率。

MTCNN 于 2016 年提出，是一种高效的人脸检测方法。MTCNN 由 3 个网络结构组成（P-Net、R-Net、O-Net）。**候选网络（Proposal Network, P-Net）**：该网络主要获取人脸区域的候选窗口和边界框回归向量，利用边界框回归对候选窗口进行校准，然后通过非极大值抑制（NMS）合并高度重叠的候选框。**精炼网络（Refine Network, R-Net）**：该网络同样通过边界框回归和 NMS 来去除假阳性区域。由于该网络结构比 P-Net 多了一个全连接层，因此在抑制假阳性方面效果更好。**输出网络（Output Network, O-Net）**：该层比 R-Net 多了一层卷积层，处理结果更加精细。其作用与 R-Net 类似，但对人脸区域施加了更多的监督，同时还会输出 5 个面部关键点（landmark）。

# 实验方法

## 人脸对齐

由于采集到的人脸图像往往形状各异，因此需要对人脸形状进行归一化处理，以便于比较。具体使用的对齐操作主要包括裁剪人脸和旋转人脸，其主要目的是去除背景噪声对人脸比对的影响，使得两张人脸在已提取有效特征的前提下尽可能准确地进行比较。

### 利用 OpenCV 的 Haar 特征提取人脸

由于 Haar 特征反映了图像的灰度变化情况，加载 OpenCV 预训练好的面部特征 XML 文件 [1] 即可用于提取人脸。具体使用的 XML 特征文件如下：

```
haarcascade_frontalface_default.xml
haarcascade_frontalface_alt.xml
haarcascade_frontalface_alt2.xml
haarcascade_frontalface_alt_tree.xml
haarcascade_profileface.xml
```

其中前 4 个 XML 文件用于提取正脸，最后一个 XML 文件用于提取侧脸。提取效果示例如下：

| 原始图片 | 提取后图片 |
|:---:|:---:|
|![image](/posts/face/images/haar_origin.jpg)|![image](/posts/face/images/haar_extract.jpg)|

实际提取效果如下表所示：

| 训练集提取数量 | 训练集提取百分比 | 测试集提取数量 | 测试集提取百分比 |
|:---:|:---:|:---:|:---:|
| 1569 | 78.45% | 1554 | 77.7% |

### 利用 MTCNN 提取人脸

MTCNN 是发表于 ECCV 2016 的工作，采用级联的卷积神经网络进行面部关键点检测，适用于人脸对齐任务。

这里使用 MXNet 框架下的 MTCNN 实现进行人脸对齐，实验示例如下：

| 原始图片 | 提取后图片 |
|:---:|:---:|
|![image](/posts/face/images/mtcnn_origin.jpg)|![image](/posts/face/images/mtcnn_extract.jpg)|

| 训练集提取数量 | 训练集提取百分比 | 测试集提取数量 | 测试集提取百分比 |
|:---:|:---:|:---:|:---:|
| 1965 | 98.25% | 1971 | 98.55% |

与 OpenCV 和 Haar 特征提取方法相比，MTCNN 不仅能提取出更多的人脸，还能对倾斜的人脸进行旋转矫正得到正脸，从而有效提高人脸比对时的准确率。

## 数据增广

在深度学习中，增加数据量可以提升模型的泛化能力。我们主要使用 Keras 的 ImageDataGenerator 和 imgaug 进行数据增广。

### 利用 ImageDataGenerator 进行数据增广

ImageDataGenerator 是 Keras 提供的 API，主要提供以下数据增广方式：

- **旋转/反射变换（Rotation/reflection）**：随机将图像旋转一定角度，改变图像内容的朝向
- **翻转变换（Flip）**：沿水平或垂直方向翻转图像
- **缩放变换（Zoom）**：按一定比例放大或缩小图像
- **平移变换（Shift）**：在图像平面上按一定方式平移图像；可采用随机或人为定义的方式指定平移范围和平移步长，沿水平或垂直方向进行平移，改变图像内容的位置
- **尺度变换（Scale）**：按指定的尺度因子对图像进行放大或缩小；或参照 SIFT 特征提取的思想，利用指定的尺度因子对图像滤波以构造尺度空间，改变图像内容的大小或模糊程度
- **对比度变换（Contrast）**：在图像的 HSV 颜色空间中，保持色调 H 不变，改变饱和度 S 和亮度 V 分量。对每个像素的 S 和 V 分量进行指数运算（指数因子在 0.25 到 4 之间），增加光照变化
- **噪声扰动（Noise）**：对图像中每个像素的 RGB 值进行随机扰动，常用的噪声模式为椒盐噪声和高斯噪声

实际生成的数据增广示例如下：

| 增广样例 1 | 增广样例 2 | 增广样例 3 | 增广样例 4 |
|:---:|:---:|:---:|:---:|
|![image](/posts/face/images/augmentation_1.png)|![image](/posts/face/images/augmentation_2.jpg)|![image](/posts/face/images/augmentation_3.jpg)|![image](/posts/face/images/augmentation_4.jpg)|

### 利用 imgaug 进行数据增广

imgaug [2] 是一个封装好的用于图像增广的 Python 库，支持多种图像变换。

主要支持的图像变换功能如下：

- 图像缩放
- 图像裁剪（crop）或填充（pad）
- 水平镜像翻转、上下翻转
- 转为灰度图
- 高斯扰动
- 锐化
- 浮雕效果
- 图像变亮或变暗

实际生成的数据增广示例如下：

| 增广样例 1 | 增广样例 2 | 增广样例 3 | 增广样例 4 |
|:---:|:---:|:---:|:---:|
|![image](/posts/face/images/augmentation_5.png)|![image](/posts/face/images/augmentation_6.jpg)|![image](/posts/face/images/augmentation_7.jpg)|![image](/posts/face/images/augmentation_8.jpg)|

在实际实验中，共生成了 91,702 张训练图片，平均每张训练集图片生成 44.85 张增广图片。

## 基于 VGGFace 进行 Finetune

在 GitHub 上，作者 rcmalli 使用 Keras 在 VGGFace 数据集上训练了人脸识别模型 [3]，使用的架构如下：

- VGG16
- RESNET50
- SENET50

作者基于以上 3 种网络架构，使用牛津大学 VGGFace 的人脸数据训练了用于人脸识别的网络。本次实验基于 RESNET50 架构的网络模型，保留全连接层之前的权重，使用增广后的训练集图片对全连接层进行 Finetune。训练过程中训练集和测试集的准确率变化曲线如下：

![image](/posts/face/images/loss_1.png)

![image](/posts/face/images/loss_2.png)

可以看出，经过 50 个 epoch 的训练，训练集最高准确率达到 0.9307，测试集最高准确率达到 0.3375。
经测试，Top 1 准确率为 0.3375，Top 5 准确率为 0.489。

## 基于 FaceNet 进行 Lazy Learning

2015 年，Google 的研究人员提出了 FaceNet，通过训练一个网络来获取人脸的 128 维特征向量，从而通过计算特征向量之间的欧氏距离来衡量人脸的相似程度。

在 GitHub 上，作者 davidsandberg 使用 Inception ResNet v1 架构，基于 VGGFace2 数据训练的 FaceNet [4] 在 LFW 上评测精度达到 0.9965。

Lazy Learning 的核心思想是计算测试样本与训练集样本之间的距离。仿照 Lazy Learning 的做法，对于每张测试人脸图片，我们计算其与所有训练集人脸的相似度，将得到的距离从低到高排序，从而返回与测试图片最相似的训练集人脸图片。

人脸提取流程如下图所示：

![image](/posts/face/images/facenet.png)

FaceNet 使用 MTCNN 提取输入图片中的人脸区域，然后使用作者提供的 compare.py 计算给定两张图片的相似度。在实验过程中，每张测试集图片都需要与训练集中的 2,000 张图片计算相似度。可以通过预先计算好图片的人脸提取结果并保存到硬盘，在计算人脸距离时直接读取之前保存的结果，从而大幅加快计算速度。

最终得到的人脸距离示例如下：

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

第一列为测试图片的索引，第二列为训练图片的索引，第三列为图片之间的距离。

将所有图片的距离从小到大排序后，输出其 top 5 索引，示例如下：

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

第一列为测试集图片索引，":" 后为训练集中距离最近的 top 5 图片索引。

经测试，使用原始的 facenet 自带模型，Top 1 准确率为 0.446，Top 5 准确率为 0.6115。

## FaceNet Finetune

此前直接使用 facenet 的原始模型，其中并不包含这 2,000 张人脸的信息。因此，我们基于原始的 facenet 模型，使用 2,000 张人脸图片作为训练集重新进行 fine-tune。

1. Loss：softmax loss + center loss + 正则项之和；训练集为 2,000 张训练图片及 2,000 张对应的灰度图片。加载 facenet 在 VGGFace 上训练的模型，进行 finetune。
2. Loss：triplet loss；训练集为 2,000 张训练图片及 8,000 张对应的增广图片。加载 facenet 在 VGGFace 上训练的模型，进行 finetune。

获得 finetune 后的模型后，按照上述流程使用 KNN 分类器（k=1，距离度量：欧氏距离）对图片进行分类。

## 集成分类器

三个基分类器的差异性主要体现在以下几个方面：

- Finetune 时参数、损失函数和训练图片不同
  - 模型 1：未进行 finetune
  - 模型 2：softmax loss + 2,000 张训练图片及 2,000 张对应的灰度图片
  - 模型 3：triplet loss + 2,000 张训练图片及 8,000 张对应的增广图片
- 提取特征时图片处理方式不同
  - 模型 1：原始图片使用 MTCNN 处理
  - 模型 2：原始图片同时使用 MTCNN 和 OpenCV 处理
  - 模型 3：灰度图片同时使用 MTCNN 和 OpenCV 处理

最终集成结果 Top 1 准确率为 0.6975，Top 5 准确率为 0.821。

# 可视化

![image](/posts/face/images/visualization_1.png)

| 导入模型运行得到的最终结果数据 | 输入待检测对象的 ID（ID 与给定测试集一致） |
|:---:|:---:|
|![image](/posts/face/images/visualization_2.png)|![image](/posts/face/images/visualization_3.png)|

最终展示最接近的 5 张人脸结果：

![image](/posts/face/images/visualization_4.png)

# 结论与思考

经测试，Top 1 准确率为 0.6975，Top 5 准确率为 0.821。

受限于时间和资源，可以改进和提升的方向如下：

- 可以对 dlib、Haar 特征和 MTCNN 这三种人脸对齐方法进行集成，更好地从训练图片和测试图片中裁剪出人脸区域，从而提高人脸比对的准确率。
- 可以考虑提取眼睛、鼻子、耳朵等面部五官特征后使用神经网络进行训练。这涉及大量的人工数据标注工作和五官特征提取方法的调研，然后对每个五官特征训练出的分类器进行集成，利用多数投票机制根据五官特征的匹配结果来匹配人脸，可能获得更高的准确率。
- 通过人工分析发现，分类器的错误主要集中在人的正脸与侧脸之间的匹配上。可以借助 TP-GAN 等技术将侧脸图片转换为正脸图片，以改善此类错误。

# 参考文献

[1] https://github.com/opencv/opencv/tree/master/data/haarcascades
[2] https://github.com/aleju/imgaug
[3] https://github.com/rcmalli/keras-vggface
[4] https://github.com/davidsandberg/facenet
