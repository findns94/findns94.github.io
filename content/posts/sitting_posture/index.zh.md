---
title: 基于侧向放置动作传感摄像头检测不良坐姿
date: 2019-02-22 20:00:00
tags: [Deep Learning, Computer Vision, Health]
categories: [Research]
---

**摘要** 坐姿检测有助于预防肌肉骨骼疾病。随着动作传感摄像头及相关软件开发工具包（SDK）的发展，利用骨骼检测技术实现相关应用已成为可能。本文介绍了一种在不打扰用户的情况下，通过侧向视角检测坐姿的方法。为分析视频流信息，文中描述了骨骼细化算法，并采用均值处理的方式从侧面精确定位主要关节。实验结果表明，该方法在检测不良坐姿方面具有较高的准确性。
**关键词** 人体工程学；动作传感摄像头；姿态识别；OpenNI

<!-- more -->

# 引言

不良坐姿被认为对青少年的身体发育构成威胁。长时间保持不当坐姿会引发一系列健康问题。已有研究指出了以下后果：儿童和青少年中背痛的流行；肌肉骨骼不适和下背部疼痛；生物力学、循环和视觉问题；长时间保持不良姿势会影响学业表现[1]。

在发达国家，肌肉骨骼疾病是一个重要的健康问题。在现代社会，最常见的病例集中在背部、肩部和颈部。根据美国国家职业安全与健康研究所（NIOSH）的报告[2]，有充分证据表明，下背部肌肉骨骼疾病以及颈肩肌肉骨骼疾病与长时间不良坐姿密切相关。Angela等人[3]发现，职业群体在久坐中暴露于不良姿势时，患下背部疼痛的风险会增加。

人们已经开发了一些方法和实现方案来减少不良坐姿带来的潜在伤害。使用动作传感摄像头有助于实时检测坐姿。人体的深度信息和三维坐标数据均可从动作传感摄像头中获取。基于OpenNI和NiTE，便携式人体工程学观察（PEO）模型被应用于不良坐姿检测。在分析视频流数据并进行图像处理后，建立了阈值方法来确定颈部和头部等主要关节的位置。结合这些关节位置和医学研究，不良坐姿可以被识别和定义。

# 相关工作

## 人工观察法

专业人员使用插图、摄影或文字描述来记录坐姿，以便进一步分析。自1974年以来，这类方法已得到充分发展，包括Priel法[4]、Ovako工作姿势分析法[5]、姿势目标法[6]和姿势记录模型[7]。

## 录像分析法

该方法利用计算机或录像设备记录用户的姿势和动作，然后由计算机进行分析。部分实现方案支持实时监测。此类方法包括快速上肢评估法（RULA）[8]、快速全身评估法（REBA）[9]、手臂动作分析法（HAMA）[10]和快速暴露检查法（QEC）[11]。

## 可穿戴传感器法

需要将专用传感器放置在用户身体上，以收集坐姿信息。传感器包括坐姿传感器、肌电图（EMG）遥测仪、三轴加速度计和皮肤贴附式电磁追踪传感器[12][13]。

# 硬件与软件

随着3D动作传感摄像头的不断发展，实时图像处理方法得以实现。以色列公司PrimeSense于2013年被苹果公司收购，开发了第一代Kinect所采用的深度摄像头技术[14]。OpenNI框架是一个开源的SDK，用于开发3D感知中间件库和应用程序[15]。PrimeSense NiTE™是最先进、最稳健的3D计算机视觉中间件，其算法利用从硬件设备接收到的深度和彩色信息，实现用户与背景分离、精确追踪用户骨骼关节等功能[16]。

图1展示了OpenNI SDK的架构。
图2展示了动作传感摄像头。
图3展示了OpenNI框架追踪的人体关节。

|图1：SDK架构[15]|图2：动作传感摄像头|图3：OpenNI框架追踪的人体关节[17]|
|:---:|:---:|:---:|
|![SDK](/posts/sitting_posture/images/SDK.png)|![motion_sensing_camera](/posts/sitting_posture/images/motion_sensing_camera.png)|![body_joints](/posts/sitting_posture/images/body_joints.png)|

# 不良坐姿检测

## 用户侧向视角

图4展示了实验装置。该装置的优势在于摄像机的视野不会被桌子遮挡。以下实验均基于此装置进行。

|图4：从用户侧向检测|图5：手部位置、颈部与躯干屈曲的定义[18]|
|:---:|:---:|
|![lateral_side](/posts/sitting_posture/images/lateral_side.png)|![definition](/posts/sitting_posture/images/definition.png)|

## 应用PEO模型

### 准备工作

摄像机放置在桌面上，距离地面1.0米。用户坐在椅子上，距离摄像机约2.0米。确保整个身体出现在摄像机视野范围内。

### 主要骨骼与关节

从PEO模型来看，图5展示了手部位置以及颈部和躯干屈曲的定义。可以看出，有效的关节点集中在躯干、颈部和头部。通过观察身体的前倾姿势，可以分别对颈部和头部设定阈值，以判断坐姿是否不良。

因此，需要定义一个理想的健康坐姿。根据O'Sullivan等人的研究[8]，主观感知的理想姿势与测试者感知的中性姿势之间差异很小。因此，本模型采用了PEO模型的参数。

本方法重点关注颈部屈曲。根据观察，当身体前倾时，人们往往会弯曲颈部。因此，颈部屈曲能够反映身体的姿态。

### 视频流分析

#### 在特定场景中识别活动用户

借助OpenNI和NiTE API，可以将用户从背景中分离出来，并获取用户的相关信息。首先，测试者需要在摄像机前移动几步。一旦身体被追踪到，系统就会稳定地监控被追踪的区域。用户坐在椅子上，检测即开始。

视频流的分辨率为320×240。每个像素在画面中具有独立的坐标和深度属性。深度的精度可达一毫米。深度指的是真实世界中的像素与摄像机之间的距离。图6展示了检测的四个步骤，以下分别进行介绍。

![four steps](/posts/sitting_posture/images/four_steps.png)
<div align="center">图6：检测的四个步骤</div>

#### 骨骼细化算法

此处设计了一种算法，用于将身体区域缩减为一条连续的曲线。该曲线由头部和颈部组成，可在下一步中进行定位。

画面左上角坐标设为(0,0)，右下角坐标设为(320, 240)。在每一帧中逐行检查所有像素。遇到身体部分后，将每行像素缩减为1~2个。为了绘制连续的曲线，被标记的像素必须与上一行的像素相邻。图8展示了该算法的流程图。图7展示了细化算法的模拟过程。图7(a)展示了算法的输入，绿色区域代表身体部分。图7(b)展示了将每行的中点标记为蓝色三角形。根据相邻规则，黄色三角形将被标记。图7(c)展示了算法完成后输出的结果（黄色像素）。

|(a) 输入|(b) 标记像素|(c) 输出|
|:---:|:---:|:---:|
|![input](/posts/sitting_posture/images/input.png)|![mark pixel](/posts/sitting_posture/images/mark_pixel.png)|![output](/posts/sitting_posture/images/output.png)|

<div align="center">图7：骨骼细化算法示例</div>

|图8：骨骼细化算法流程图|图9：均值处理流程图|
|:---:|:---:|
|![skeleton thinning](/posts/sitting_posture/images/skeleton_thinning.png)|![averaging process](/posts/sitting_posture/images/averaging_process.png)|

#### 均值处理

由于用户的头部垂直于摄像机的方向，且观察发现手臂比头部更靠近摄像机，因此深度信息在头部区域变化较为平稳，而手臂区域的深度值相对更低。为了定位深度发生突变的像素，采用均值处理来解决此问题。

图9展示了均值处理的流程图。前20行像素有可能与背景混合，跳过这些像素以避免由相邻像素深度不准确导致的误差。接下来10行像素的深度取平均值，作为头部的平均深度。继续对下一个像素的深度进行平均，直到深度发生突变（−60）为止。

图10展示了原始深度与均值处理后深度的变化趋势。图11展示了原始深度差与均值处理后深度差的变化趋势。原始深度差没有发生突变；突变发生在第53至第68个像素之间，深度差小于−40。结合观察结果，选择−60作为突变阈值，即第57个像素大约对应颈部位置。

然后，在颈部与连续曲线的第一个像素之间取中点，来确定头部的位置。该中点也位于曲线上。跳过的像素数量和平均的像素数量取决于摄像机与用户之间的距离以及检测效果。因此，跳过前20个像素。

|图10：自上而下的深度变化|图11：自上而下的深度差变化|
|:---:|:---:|
|![depth](/posts/sitting_posture/images/depth.png)|![difference](/posts/sitting_posture/images/difference.png)|

#### 阈值判定

Chaffin和Kilbom发现，有充分证据表明肌肉骨骼疾病与颈部屈曲超过20°之间存在正相关关系[19]。在获得颈部和头部位置后，屈曲角α定义如下：

$$\alpha = \arctan{\left| \frac{x_{neck}-x_{head}}{y_{neck}-y_{head}} \right|}$$

OpenNI提供两种不同的坐标系——深度坐标系和坐标系坐标系。深度坐标系是本机数据表示。世界坐标系则将更熟悉的三维笛卡尔坐标系叠加到世界上，以摄像机镜头为原点[20]。此处，颈部和头部的坐标从深度坐标系转换到世界坐标系，从而获得x_neck、y_neck、x_head和y_head。

一旦α超过20°，系统将通过声音提醒用户纠正坐姿。听到警报后，用户应意识到坐姿不正确并坐直。当α低于20°时，坐姿符合健康指标系统将继续检测，不会打扰用户。

# 测试与评估

图4展示了实验环境。邀请一名志愿者进行了一系列坐姿测试。为了检验该方法的准确性，测试包含了200种不同的不良坐姿。各测试之间完成身体追踪所需的时间没有显著差异。基于关节识别和阈值判定方法，测试结果如表1所示。

<div align="center">表1 坐姿检测结果测试</div>

| 不良坐姿总数 | 已识别不良坐姿数 | 未识别不良坐姿数 |
| :---: | :---: | :---: |
| 200 | 188 | 12 |

为了确定体型和服装等因素是否影响检测准确性，邀请了五名志愿者参与测试。志愿者重复不良坐姿各50次。结果如表2所示。

<div align="center">表2 不同因素测试结果</div>

| 因素类型 | 身高体重 | 不良坐姿总数 | 已识别不良坐姿数 |
| :---: | :---: | :---: | :---: |
| 偏胖 | 180cm 105kg | 50 | 50 |
| 偏瘦 | 174cm 62kg | 50 | 48 |
| 高个 | 180cm 55kg | 50 | 48 |
| 矮个 | 165cm 50kg | 50 | 47 |
| 薄衣 | 170cm 70kg | 50 | 50 |
| 厚衣 | 170cm 70kg | 50 | 47 |

# 结论

本文提出了一种利用动作传感摄像头技术检测不良坐姿的系统。该系统包含骨骼细化算法、均值处理和阈值判定方法。检测不良坐姿为预防肌肉骨骼疾病提供了一种途径。实验表明，该方法能够高效运行，且对用户的服装和体型具有不变性（invariant）。

# 参考文献

[1] Mebarki, B. (2009). Effect of school furniture design and traditional sitting habits on sitting postures of middle school pupils in the Touet region, Algeria. PROCEEDINGS OF 17TH WORLD CONGRESS ON ERGONOMICS.
[2] Putz-Anderson, V., Bernard, B. P., Burt, S. E., Cole, L. L., Fairfield-Estill, C., Fine, L. J., ... & Tanaka, S. (1997). Musculoskeletal disorders and workplace factors. National Institute for Occupational Safety and Health (NIOSH).
[3] Lis, A. M., Black, K. M., Korn, H., & Nordin, M. (2007). Association between sitting and occupational LBP. European Spine Journal, 16(2), 283-298.
[4] Priel, V. Z. (1974). A numerical definition of posture. Human Factors: The Journal of the Human Factors and Ergonomics Society, 16(6), 576-584.
[5] Karhu, O., Kansi, P., & Kuorinka, I. (1977). Correcting working postures in industry: a practical method for analysis. Applied Ergonomics, 8(4), 199-201.
[6] Corlett, E. N., MADELEY†, S., & MANENICA‡, I. (1979). Posture targeting: a technique for recording working postures. Ergonomics, 22(3), 357-366.Gil, H. C., & Tunes, E. (1989). Posture recording: a model for sitting posture. Applied Ergonomics, 20(1), 53-57.
[7] Gil, H. C., & Tunes, E. (1989). Posture recording: a model for sitting posture. Applied Ergonomics, 20(1), 53-57.
[8] McAtamney, L., & Corlett, E. N. (1993). RULA: a survey method for the investigation of work-related upper limb disorders. Applied Ergonomics, 24(2), 91-99.
[9] Hignett, S., & McAtamney, L. (2000). Rapid Entire Body Assessment (REBA). Applied Ergonomics, 31(2), 201-205.
[10] Christmansson, M. (1994). Repetitive and manual jobs—content and effects in terms of physical stress and work‐related musculoskeletal disorders. International Journal of Human Factors in Manufacturing, 4(3), 281-292.
[11] Li, G., & Buckle, P. (1999). Evaluating change in exposure to risk for musculoskeletal disorders: A practical tool. HSE Books.
[12] Finley, M. A., & Lee, R. Y. (2003). Effect of sitting posture on 3-dimensional scapular kinematics measured by skin-mounted electromagnetic tracking sensors. Archives of Physical Medicine and Rehabilitation, 84(4), 563-568.
[13] Wong, W. Y., & Wong, M. S. (2008). Detecting spinal posture change in sitting positions with tri-axial accelerometers. Gait & Posture, 27(1), 168-171.
[14] Microsoft, "PrimeSense Supplies 3-D-Sensing Technology to 'Project Natal' for Xbox 360" [Online], Available: https://news.microsoft.com/2010/03/31/primesense-supplies-3-d-sensing-technology-to-project-natal-for-xbox-360/, [February 1, 2016].
[15] PrimeSense, Ltd., "What is OpenNI?", [Online], Available: http://www.openni.ru/index.html, [February 1, 2016].
[16] PrimeSense, Ltd., "NiTE 2.2.0.11", [Online], Available: http://www.openni.ru/files/nite/index.html, [February 1, 2016].
[17] NiTE, JointType, [Online], Available: http://img.my.csdn.net/uploads/201111/8/0_13207656556UXJ.gif, [February 1, 2016].
[18] Fransson-Hall, C., Gloria, R., Kilbom, Å., Winkel, J., Karlqvist, L., Wiktorin, C., & Group123, S. (1995). A portable ergonomic observation method (PEO) for computerized on-line recording of postures and manual handling. Applied Ergonomics, 26(2), 93-100.
[19] O'Sullivan, K., O'Dea, P., Dankaerts, W., O'Sullivan, P., Clifford, A., & O'Sullivan, L. (2010). Neutral lumbar spine sitting posture in pain-free subjects. Manual Therapy, 15(6), 557-561
[20] PrimeSense, Ltd., "openni::CoordinateConverter Class Reference", [Online], Available: http://www.openni.ru/wp-content/doxygen/html/classopenni_1_1_coordinate_converter.html, [February 1, 2016]
