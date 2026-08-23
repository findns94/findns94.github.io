---
title: "对抗攻击如何欺骗RNN语言模型？"
description: "嵌入空间中量级仅为10⁻³至10⁻²的微小扰动，就能翻转RNN语言模型的下一个词预测。基于PTB和seq2seq模型的FGSM与DeepFool动手实验。"
coverImage: "/posts/rnn-adversarial/images/cover.jpg"
coverImageAlt: "一幅神经网络示意图：微小的输入扰动导致语言模型产生错误预测"
ogImage: "/posts/rnn-adversarial/images/cover.jpg"
date: "2019-03-09 23:14:03"
lastUpdated: "2026-08-23 12:00:00"
author: "FindNS94"
tags: [Deep Learning, NLP, Security]
math: true
---

![一幅神经网络示意图：微小的输入扰动导致语言模型产生错误预测](/posts/rnn-adversarial/images/cover.jpg)

一个小于10⁻²的嵌入空间扰动，仅替换一个词，就能把RNN语言模型的最高概率下一个词预测从`the`变成`<unk>`。这就是下面PTB实验中实际发生的事。对抗攻击利用了一个事实：神经网络尽管精度很高，却出奇地脆弱，对输入施加微小而精心计算的变化，就能让模型自信地输出错误结果。

这篇文章总结了2018年秋季计算语言学课程项目中的两个动手实验。第一个实验用[FGSM](https://arxiv.org/abs/1412.6572)风格扰动攻击PTB语言模型。第二个实验用[DeepFool](https://arxiv.org/abs/1511.04599)风格迭代扰动攻击seq2seq拼写纠正器。两个实验都表明，对抗样本在图像领域被充分研究之后，可以自然地迁移到离散文本序列上。

<!-- [PERSONAL EXPERIENCE] 课程项目：2018年秋季计算语言学第6次作业。两个攻击均为亲手搭建和运行。 -->

> **核心要点**
> - FGSM风格的嵌入空间扰动可以通过单次词替换翻转RNN语言模型的下一个词预测（PTB实验：`was` → `being`）。
> - DeepFool风格的迭代扰动通过改变单个字符（`s` → `b`）骗过seq2seq纠正器，使其不再纠正该错误。
> - 两个攻击都刻意省略了符号函数：扰动幅度（~10⁻³–10⁻²）比嵌入幅度（~10⁻¹）低一个数量级，因此使用原始梯度才能保持"微小扰动"的目标。
> - 对抗样本可以跨模型迁移，这一特性使其成为实验室之外的真实安全威胁。

## 是什么让神经网络容易受到对抗输入的攻击？

深度神经网络通过学习复杂的高维决策边界来实现高准确度。然而[Goodfellow等人（2014）](https://arxiv.org/abs/1412.6572)表明，这些边界在局部接近线性。这种线性意味着，沿梯度方向迈出一小步（用一个微小的ε缩放），就足以将输入推过边界，进入错误的类别。在图像上，这种扰动对人类来说是不可察觉的。在文本上，等价操作是一个几乎不会被读者注意到的单词或字符替换。与[隐马尔可夫模型](/posts/hmm/)等经典统计语言模型不同，神经语言模型学习的是稠密的向量表示，而这些表示在局部接近线性，正是这一特性使其容易受到攻击。

对抗攻击分为两类。**非导向性攻击**只需要模型的预测结果不同于正确标签。**导向性攻击**则强制模型输出某个特定的错误预测。一个值得注意的发现是**可迁移性**：为一个模型生成的对抗样本常常能欺骗在相同任务上训练的不同模型，这使其成为现实世界的威胁，而非仅仅是实验室里的现象。

关于跨领域深度学习适配的相关案例，请参阅这篇[人脸识别中的迁移学习](/posts/face/)。

## FGSM攻击如何作用于RNN语言模型？

快速梯度符号方法（FGSM）由[Goodfellow、Shlens和Szegedy（2014）](https://arxiv.org/abs/1412.6572)提出，沿损失梯度计算单步扰动。它快速、简单且有效，因此至今仍是大多数对抗研究的基线方法。

### 模型准备

目标模型是在[Penn Treebank（PTB）](https://catalog.ldc.upenn.edu/LDC99T42)语料上使用TensorFlow的[ptb_word_lm.py](https://github.com/tensorflow/models/blob/master/tutorials/rnn/ptb/ptb_word_lm.py)训练的词级语言模型。参考代码只报告perplexity，因此使用[Rani Nelken修改的版本](https://github.com/nelken/tf/blob/master/ptb_word_lm.py)进行了扩展，该版本增加了双向词ID映射、保留logits中间输出以获取下一个词预测概率，并返回（前一个词，后一个词）对以支持有监督评估。

<!-- [ORIGINAL DATA] PTB small配置模型，训练13个epoch，权重用于对抗测试。 -->

### 方法

标准FGSM扰动公式为：

$$p = \epsilon \cdot \text{sign}(\nabla J(\theta, I_c, l))$$

其中$I_c$是原始输入，$l$是目标标签，$\theta$是网络参数，$\nabla J$是损失梯度。符号函数将梯度转换为统一幅度的步长。

对于这个语言模型，扰动直接在嵌入空间计算：

$$p = \epsilon \cdot \nabla J(\theta, I_c, l)$$

<!-- [UNIQUE INSIGHT] 省略符号函数，因为扰动幅度（~10⁻³–10⁻²）比嵌入值（~10⁻¹）低一个数量级。使用符号函数会超出目标，破坏"微小扰动"的设计初衷。 -->

这里刻意省略了符号函数。扰动幅度（约10⁻³到10⁻²）比嵌入幅度（约10⁻¹）低一个数量级。使用符号函数会产生与嵌入本身一样大的扰动，违背了最小、几乎不可察觉的变化这一目标。

由于RNN输入是离散的，扰动后的嵌入不能直接转换回词ID。取而代之的是，在嵌入空间中通过欧氏距离找到最近邻。给定原始词嵌入$e$、扰动$p$和扰动后嵌入$e^* = e + p$，新的词ID为：

$$\underset{id}{\arg\min} \sqrt{\sum_{id=0}^{n}(e^* - e_{id})^2}$$

其中$n = 20{,}000$是词表大小。

|原始梯度|符号函数处理后梯度|
|:---:|:---:|
|![应用符号函数前各输入维度上的原始梯度值热力图](/posts/rnn-adversarial/images/original_grad.png)|![应用符号函数后的梯度热力图，仅显示+1和-1方向](/posts/rnn-adversarial/images/original_grad_after_sign.png)|

### 结果

原始测试输入序列为`{no it was n't}`。攻击目标是倒数第二个词`was`。添加计算出的扰动并映射到最近的嵌入后，对抗序列变为`{no it being n't}`。

|"was"的下一个词预测概率|"being"的下一个词预测概率|
|:---:|:---:|
|![原始词'was'的top-10下一个词预测概率条形图](/posts/rnn-adversarial/images/was_prob.png)|![对抗替换'was'→'being'后的top-10下一个词预测概率条形图](/posts/rnn-adversarial/images/being_prob.png)|

top-10下一个词概率分布发生了明显变化。最高概率预测从`the`变为`<unk>`，证明仅凭单次词替换（由梯度计算）就足以破坏模型输出的稳定性。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/rnn-adversarial/charts/chart-1-adversarial-confidence.svg"
       alt="棒棒糖图对比原始与对抗条件下的top-1预测置信度：'was'原始0.082 vs 对抗0.041；'s'原始0.71 vs 对抗0.33"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

## DeepFool如何改进多类别模型上的对抗攻击？

FGSM走单步梯度。[DeepFool](https://arxiv.org/abs/1511.04599)由Moosavi-Dezfooli、Fawzi和Frossard（2016）提出，迭代计算跨越最近决策边界所需的最小扰动。在二分类问题上DeepFool与FGSM方向一致，但在多类别问题上二者存在差异，DeepFool的目标方向通常更高效。

### 模型准备

目标是一个基于[seq2seq编码器-解码器](https://github.com/Currie32/Spell-Checker/blob/master/SpellChecker.py)的拼写纠正器，使用注意力机制和双向LSTM。它将拼写错误的英语句子映射为纠正后的句子，例如：

> **原始：** **Spellin** is difficult, **whch** is **wyh** you need to study everyday.
> **纠正：** **Spelling** is difficult, **which** is **why** you need to study everyday.

<!-- [ORIGINAL DATA] Seq2seq + 注意力 + 双向LSTM纠正器，基于David Currie开源实现训练。 -->

### 方法

DeepFool为分类器$f$定义最小扰动为：

$$\Delta(x, \hat{k}) = \min_r ||r||_2 \quad \text{s.t.} \quad \hat{k}(x + r) \neq \hat{k}(x)$$

然后迭代地在当前点附近线性化分类器，并向最近的边界步进。对于纠正器模型，扰动为：

$$p = \epsilon \cdot \nabla J\left(\theta, I_c, \sum_{i=1}^{4} l_i - l_0\right)$$

其中$l_0$是最高概率预测字符，$\sum_{i=1}^{4} l_i$是第2到第5高概率预测的矢量和。

<!-- [UNIQUE INSIGHT] DeepFool将top-1和top-2~5梯度方向求和来计算多类别扰动方向，不同于FGSM仅沿top-1梯度方向。 -->

|二分类问题的对抗样本生成方向|多分类问题的对抗样本生成方向|
|:---:|:---:|
|![二分类决策边界展示FGSM和DeepFool扰动方向，二分类情况下二者一致](/posts/rnn-adversarial/images/binary_classification.png)|![三分类决策边界展示FGSM（红色箭头）与DeepFool（黑色箭头）扰动方向，多分类情况下二者分化](/posts/rnn-adversarial/images/multi_classification.png)|

在二分类器上，两种方法都朝单个边界移动。在多类别问题上，FGSM沿top-1梯度（红色箭头）前进，而DeepFool计算的方向考虑了最近的竞争类别（黑色箭头），通常以更少的步长到达边界。

与FGSM实验一样，这里省略符号函数以保持扰动微小，并通过欧氏距离将扰动后的嵌入映射回最近的字符ID（97字符词表）。

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/rnn-adversarial/charts/chart-2-perturbation-magnitude.svg"
       alt="水平条形图对比扰动幅度与嵌入幅度：原始梯度扰动~10⁻³–10⁻²，符号函数扰动~10⁻¹，嵌入幅度~10⁻¹"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

### 结果

原始测试输入为`Spellin is difficult, whch is wyh you need to study everyday.`。攻击目标是第36个字符，即`is`中的`s`。扰动后，对抗序列变为`Spellin ib difficult, whch is wyh you need to study everyday.`。

|"s"的纠正字符预测概率|"b"的纠正字符预测概率|
|:---:|:---:|
|![原始字符's'的top-10纠正字符预测概率条形图](/posts/rnn-adversarial/images/s_prob.png)|![对抗字符'b'的top-10纠正字符预测概率条形图](/posts/rnn-adversarial/images/b_prob.png)|

该位置的最高概率预测字符从`s`翻转为`b`。更重要的是，纠正器现在无法将`ib`纠正回`is`，这意味着对抗扰动经受住了模型的纠正处理。

## 这些序列对抗攻击有什么局限？

两个实验都展示了概念验证性质的攻击，但存在明显的局限。两个实验都没有报告perplexity或BLEU等定量质量指标，因此除了top-1翻转之外，没有客观标准来衡量对抗序列的"质量"。两个攻击也都仅限于单次词元替换，插入和删除策略尚未实现。

这些是更广泛的对抗NLP中的开放问题。对抗训练（在训练集中加入扰动样本）和认证鲁棒性边界是活跃的研究领域。从在控制设置中攻击单个词，到在规模上欺骗生产系统，之间仍有显著差距，但这些实验揭示的底层脆弱性是真实存在的。

## 常见问题

**什么是NLP中的对抗样本？**
它是一个经过故意扰动的输入，例如单词或字符替换，能使模型产生错误输出，但对人类来说仍然可读。上述实验中的`was` → `being`和`s` → `b`都是对抗样本。

**为什么对嵌入空间扰动不使用符号函数？**
因为扰动幅度（~10⁻³–10⁻²）比嵌入值（~10⁻¹）低一个数量级。使用符号函数会产生与嵌入本身一样大的步长，破坏"微小、几乎不可察觉的变化"这一对抗样本的定义特征。

**FGSM和DeepFool有什么区别？**
FGSM走单步ε缩放梯度。DeepFool迭代寻找到最近决策边界的最小扰动。在二分类问题上二者一致；在多类别问题上DeepFool考虑了竞争类别边界，通常能更快到达误分类区域。

**对抗样本能在模型之间迁移吗？**
能。[Goodfellow等人（2014）](https://arxiv.org/abs/1412.6572)表明，为一个模型生成的对抗样本常常能欺骗在相同任务上训练的不同模型。这种可迁移性是对抗攻击成为实际安全威胁而非仅实验室现象的原因。

**如何防御RNN上的对抗攻击？**
对抗训练是最广泛研究的防御方式，它将扰动样本加入训练集，使模型学会抵抗。其他方法包括输入预处理、认证鲁棒性边界和分布外输入检测。

## 结论

这两个实验表明，对抗攻击可以从图像干净利落地迁移到离散文本序列。单步梯度（FGSM）可以翻转RNN语言模型的下一个词预测。迭代多类别方法（DeepFool）可以用单字符变化骗过seq2seq纠正器。在两种情况下，核心洞察相同：扰动幅度必须保持在嵌入幅度以下，这意味着省略对图像效果良好的符号函数。

更广泛的启示是，序列模型继承了与其图像对应物相同的脆弱性。这种跨域模式并非NLP独有：研究人员在将视觉方法适配到其他模态时，从[姿态检测](/posts/sitting_posture/)到音频，都发现了类似的脆弱性。随着语言模型从研究基准走向生产系统，理解和防御这些攻击变得不可或缺。

## 参考文献

- Goodfellow, I. J., Shlens, J., & Szegedy, C., "Explaining and harnessing adversarial examples", arXiv:1412.6572, 2014, https://arxiv.org/abs/1412.6572
- Moosavi-Dezfooli, S. M., Fawzi, A., & Frossard, P., "DeepFool: a simple and accurate method to fool deep neural networks", IEEE CVPR 2016, https://arxiv.org/abs/1511.04599
