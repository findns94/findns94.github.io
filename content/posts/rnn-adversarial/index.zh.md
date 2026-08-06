---
title: 基于RNN生成对抗输入序列
date: 2019-03-09 23:14:03
tags: [Deep Learning, NLP, Security]
categories: [Research]
math: true
---

本文是2018年秋季计算语言学课程第6次作业的总结，任务是基于RNN生成对抗输入序列。

首先总体介绍一下对抗样本攻击的概念。一些研究人员发现，尽管深度神经网络具有很高的精确度，但对输入施加微小的扰动就可能导致模型预测结果完全错误。对于图像而言，这种扰动通常十分微小而难以被察觉（人类无法直观感知图像中的变化），但这些对抗输入样本却能成功欺骗深度学习模型。这种欺骗神经网络模型的攻击大致可分为两类：非导向性攻击只需使图像的预测结果与原始标签不一致，而导向性攻击则需将图像错误预测为特定类别。值得注意的是，研究人员发现生成的对抗样本对其他模型仍然有效，这就是对抗样本的可迁移性（transferability）。

<!-- more -->

这里展示的结果主要是在卷积神经网络（CNN）上生成的对抗样本：

![cnn_adversarial_example](/posts/rnn-adversarial/images/cnn_adversarial_example.PNG)

# 生成PTB语言模型的对抗输入序列

## 模型准备

首先尝试运行TensorFlow提供的语言模型训练[代码](https://github.com/tensorflow/models/blob/master/tutorials/rnn/ptb/ptb_word_lm.py)。运行后发现，该代码仅打印模型的perplexity，没有提供输入一段话/一个词来预测下一个词的接口。因此，又参考了Rani Nelken在GitHub上基于PTB语言模型训练代码修改的[版本](https://github.com/nelken/tf/blob/master/ptb_word_lm.py)，其主要差异在于：

- 建立了数字ID与单词ID之间的双向映射
- 微调了RNN结构，主要修改了从RNN输出到损失计算的过程，保留了中间结果logits，从而获得下一个词预测的概率
- 修改了文件读取代码，使每轮迭代返回测试文本中的前一个词x和后一个词y

使用Rani Nelken版本的代码，经过small参数训练13个epoch后，得到了可用于测试的语言模型权重。

## 对抗输入序列生成思路

这里模仿**FGSM**方法来生成对抗输入序列。首先简要介绍FGSM方法[1]：

FGSM（Fast Gradient Sign Method）是Ian Goodfellow等人于2015年提出的计算对抗扰动的方法。FGSM利用深层网络模型在高维空间中的"线性"性质（尽管此类模型通常被认为是高度非线性的）来高效地生成大量对抗样本。

FGSM方法计算扰动的公式如下：

$$p = \epsilon sign(\nabla J(\theta,I_c,l))$$

其中$I_c$代表原始图像，$l$是错误分类的类别标签，$\theta$是神经网络参数，$\nabla J$表示在原始图像$I_c$上计算代价函数对网络模型参数$\theta$的梯度，$sign$是符号函数（将原本非线性的扰动变为线性扰动），定义如下：

$$
sign(x) = \begin{cases}
1, & x>0 \\
0, & x=0 \\
-1, & x<0 \\
\end{cases}
$$

$\epsilon$的作用是将扰动强度限制在尽可能小的范围内。下面两张图分别直观地展示了原始梯度和经过符号函数处理后的梯度示例。

|原始梯度|符号函数处理后梯度|
|:---:|:---:|
|![original_grad](/posts/rnn-adversarial/images/original_grad.png)|![original_grad_after_sign](/posts/rnn-adversarial/images/original_grad_after_sign.png)|

在语言模型的执行过程中，计算扰动p的公式如下：

$$p = \epsilon \nabla J(\theta,I_c,l)$$

其中$I_c$代表原始输入序列对应的embedding，$l$是RNN最终状态输出经logits计算后分类的类别标签，$\theta$是神经网络参数，$\nabla J$表示在输入序列对应的embedding $I_c$上计算代价函数对网络模型参数$\theta$的梯度，$\epsilon$是可以人为控制的扰动幅度。

此处未使用符号函数$sign$的原因主要是：扰动的数量级（约$10^{-3}$~$10^{-2}$）小于embedding的数量级（约$10^{-1}$）。如果使用符号函数$sign$，会导致扰动后的embedding过大，计算出的距离偏大，与"微小"扰动的设计目标相去甚远。

由于RNN语言模型的输入序列是离散的——即输入的单词在转化为数字ID后，还经过一层embedding层转化为向量再参与RNN计算——即使直接将扰动p加在原始embedding $I_c$上，也有很大概率无法将embedding直接映射回某个单词ID。因此，此处采用计算最近邻欧氏距离的方式，将加上扰动后的embedding转化为距离最近的单词ID，从而改变输入序列。过程如下，其中$e$代表原始单词ID对应的embedding，$p$代表扰动，$e^*$代表加上扰动后的embedding：

$$e^* = e + p$$

然后求解与扰动后embedding $e^*$距离最近的embedding对应的ID，其中n为语料库中的单词数量，本实验中n=20000：

$$argmin_{id}{\sqrt{\sum_{id=0}^{n}(e^{*}-e_{id})^2}}$$

## 对抗输入序列生成结果

### 对抗输入序列示例

此处使用的原始测试输入序列为`{no it was n't}`。我们对倒数第二个单词`was`进行对抗输入序列的生成，通过添加求得的扰动，得到对抗序列`{no it being n't}`。由此我们可以观察倒数第二个单词的下一个词预测概率的变化。

### 下一个词预测概率分布可视化

|was的下一个词预测概率|being的下一个词预测概率|
|:---:|:---:|
|![was_prob](/posts/rnn-adversarial/images/was_prob.png)|![being_prob](/posts/rnn-adversarial/images/being_prob.png)|

可以看出，对抗序列的下一个词预测Top 10概率分布发生了变化，尤其是Top 1预测词从`the`变成了`<unk>`。本实验仍存在一些不足，例如缺乏量化指标（如perplexity等）来评估所生成对抗输入序列的质量。未来可以考虑将对抗序列加入语言模型的重训练过程。

# 生成seq2seq语言纠错模型的对抗输入序列

## 模型准备

此处采用的语言纠错模型基于David Currie在GitHub上开源的[代码](https://github.com/Currie32/Spell-Checker/blob/master/SpellChecker.py)，主要采用了基于seq2seq的encoder-decoder网络结构，同时还使用了attention和双向LSTM等结构。其目的是训练面向英语语料的语言纠错模型，示例如下：

> 原始序列：**Spellin** is difficult, **whch** is **wyh** you need to study everyday.
> 纠正序列：**Spelling** is difficult, **which** is **why** you need to study everyday.

> 原始序列：The first days of her existence in **th** country were **vrey** hard for Dolly.
> 纠正序列：The first days of her existence in **the** country were **very** hard for Dolly.

使用David Currie的代码，经过调整若干参数后进行训练，得到了可用于生成语言纠错模型对抗输入序列的模型权重。由于训练参数等因素，实际纠错效果并未达到作者演示的水平，仍存在部分单词未能被纠正的情况，不过这不会影响本实验。

## 对抗输入序列生成思路

这里模仿**DeepFool**方法来生成对抗输入序列。首先简要介绍DeepFool方法[2]：

给定一个分类器模型f，Moosavi-Dezfooli等人首先定义了使图像分类结果k出错的最小扰动r，如下式所示：

$$\Delta(x, \hat{k}) = min_r||r||_2, s.t.\ \hat{k}(x+r) \ne \hat{k}(x)$$

在上述定义的基础上，Moosavi-Dezfooli提出了DeepFool模型：**以迭代方式计算给定图像的最优扰动方向**，沿该方向可快速、高效地生成大量对抗样本。

从简单二分类模型的角度来看，生成对抗样本的方向如下图所示：

|二分类问题对抗样本生成方向|多分类问题对抗样本生成方向|
|:---:|:---:|
|![binary_classification](/posts/rnn-adversarial/images/binary_classification.png)|![multi_classification](/posts/rnn-adversarial/images/multi_classification.png)|

FGSM和DeepFool的目标都是使模型预测分类错误，因此都需要扰动原始图像$x_0$，使其向分类错误的方向移动——也就是梯度上升的方向（虚线箭头方向）进行变异。在二分类模型上，DeepFool与FGSM在扰动方向上没有区别；但在多分类问题上，二者存在显著差异，具体如上图所示。

在这个简单的三分类问题中，假设原始图像$x_0$被模型分类为$y_1$。为了使其分类错误，FGSM模型会沿$y_1$分类错误的方向——即图中红色箭头方向——添加扰动进行变异。

而DeepFool方法认为，若将$x_0`移动到图中的三角形区域，分类错误的概率将大大增加。基于此假设，DeepFool同时计算Top 1分类结果的梯度和Top 2分类结果的梯度，并将这两个梯度矢量相加，得到图像添加扰动的方向——即图中黑色实线所代表的原始图像$x_0$的变异方向。

在语言纠错模型的执行过程中，计算扰动p的公式如下：

$$p = \epsilon \nabla J(\theta,I_c,\sum_{i=1}^4l_i - l_0)$$

其中$I_c$代表原始输入序列对应的embedding，$l_0$是RNN预测序列中随机选择一个字母对应的最终状态输出经logits计算后的Top 1类别标签，$\sum_{i=1}^4l_i`为Top 2 ~ Top 5类别标签的矢量求和，$\theta$是神经网络参数，$\nabla J$表示在输入序列对应的embedding $I_c$上计算代价函数对网络模型参数$\theta$的梯度，$\epsilon$是可以人为控制的扰动幅度。

此处未使用符号函数的原因同样主要是：扰动的数量级（约$10^{-3}$~$10^{-2}$）小于embedding的数量级（约$10^{-1}$）。如果使用符号函数$sign$，会导致扰动后的embedding过大，计算出的距离偏大，与"微小"扰动的设计目标相去甚远。

由于RNN语言模型的输入序列是离散的——即输入的单词在转化为数字ID后，还经过一层embedding层转化为向量再参与RNN计算——即使直接将扰动p加在原始embedding $I_c$上，也有很大概率无法将embedding直接映射回某个单词ID。因此，此处采用计算最近邻欧氏距离的方式，将加上扰动后的embedding转化为距离最近的单词ID，从而改变输入序列。过程如下，其中$e$代表原始单词ID对应的embedding，$p$代表扰动，$e^*$代表加上扰动后的embedding：

$$e^* = e + p$$

然后求解与扰动后embedding $e^*$距离最近的embedding对应的ID，其中n为语料库中的单词数量，本实验中n=79：

$$argmin_{id}{\sqrt{\sum_{id=0}^{n}(e^{*}-e_{id})^2}}$$

## 对抗输入序列生成结果

### 对抗输入序列示例

此处使用的原始测试输入序列为：

> Spellin i**s** difficult, whch is wyh you need to study everyday.

我们对第36个字符`o`进行对抗输入序列的生成，通过对每个可能输入字母的embedding添加求得的扰动，得到如下对抗序列：

> Spellin i**b** difficult, whch is wyh you need to study everyday.

这两个序列的区别在于`is`中的`s`被替换为`b`，由此我们可以观察替换前后对应位置纠正字母预测概率的变化。

### 纠正字符预测概率分布可视化

可以看出，对抗序列对应位置字符的预测Top 10概率分布发生了变化，尤其是Top 1预测字符从`s`变成了`b`。从纠正结果来看，`ib`并未被纠正为`is`。

|"s"的纠正字符预测概率|"b"的纠正字符预测概率|
|:---:|:---:|
|![s_prob](/posts/rnn-adversarial/images/s_prob.png)|![b_prob](/posts/rnn-adversarial/images/b_prob.png)|

本实验仍存在一些不足，例如缺乏量化指标（如perplexity或BLEU等）来评估所生成语言纠错模型对抗输入序列的质量。此外，本方法生成的对抗序列仅限于替换单个字符，尚未实现插入或删除策略。未来可以考虑将对抗序列加入语言纠错模型的重训练过程。

# 参考文献

[1] Goodfellow, I. J., Shlens, J., & Szegedy, C. Explaining and harnessing adversarial examples (2014). arXiv preprint arXiv:1412.6572.

[2] Moosavi-Dezfooli, S. M., Fawzi, A., & Frossard, P. (2016). Deepfool: a simple and accurate method to fool deep neural networks. In Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (pp. 2574-2582).
