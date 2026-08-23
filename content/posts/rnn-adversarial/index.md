---
title: "How Do Adversarial Attacks Fool RNN Language Models?"
description: "Small input perturbations can flip an RNN's next-word prediction with near-certainty in targeted settings. A hands-on FGSM and DeepFool experiment on PTB and seq2seq models."
coverImage: "/posts/rnn-adversarial/images/cover.jpg"
coverImageAlt: "A neural network diagram showing small input perturbations causing a language model to produce wrong predictions"
ogImage: "/posts/rnn-adversarial/images/cover.jpg"
date: "2019-03-09 23:14:03"
lastUpdated: "2026-08-23 12:00:00"
author: "FindNS94"
tags: [Deep Learning, NLP, Security]
math: true
---

![A neural network diagram showing small input perturbations causing a language model to produce wrong predictions](/posts/rnn-adversarial/images/cover.jpg)

A perturbation smaller than 10⁻² in embedding space, applied to a single word, can flip an RNN language model's top next-word prediction from `the` to `<unk>`. That is what happened in the Penn Treebank (PTB) experiment described below. Adversarial attacks exploit the fact that neural networks, despite their impressive accuracy, are surprisingly fragile: small, carefully computed changes to the input produce confidently wrong outputs.

This post summarizes two hands-on experiments from a Fall 2018 Computational Linguistics course project. The first attacks a PTB language model using a [FGSM](https://arxiv.org/abs/1412.6572)-style perturbation. The second attacks a seq2seq spell corrector using a [DeepFool](https://arxiv.org/abs/1511.04599)-style iterative perturbation. Both show that adversarial examples, well studied on images, transfer naturally to discrete text sequences.

<!-- [PERSONAL EXPERIENCE] Course project: CL6 assignment, Fall 2018. Built and ran both attacks first-hand. -->

> **Key Takeaways**
> - An FGSM-style perturbation in embedding space can flip an RNN language model's next-word prediction with a single-word substitution (PTB experiment: `was` → `being`).
> - A DeepFool-style iterative perturbation fools a seq2seq corrector by changing one character (`s` → `b`) so the model no longer corrects it.
> - Both attacks deliberately omit the sign function: perturbation magnitude (~10⁻³–10⁻²) is an order of magnitude below embedding magnitude (~10⁻¹), so raw gradients preserve the "small perturbation" goal.
> - Adversarial examples transfer across models, a property that makes them a practical security concern beyond the lab.

## What Makes Neural Networks Vulnerable to Adversarial Inputs?

Deep neural networks achieve high accuracy by learning complex, high-dimensional decision boundaries. Yet as [Goodfellow et al. (2014)](https://arxiv.org/abs/1412.6572) showed, these boundaries are locally close to linear. That linearity means a small step along the gradient direction, scaled by a tiny ε, is enough to push an input across the boundary into the wrong class. On images, the perturbation is imperceptible to humans. On text, the equivalent is a single word or character substitution that a reader would barely notice. Unlike classical statistical language models such as the [hidden Markov model](/posts/hmm/), neural language models learn dense vector representations that turn out to be locally linear, which is exactly what makes them vulnerable.

Adversarial attacks fall into two categories. **Untargeted attacks** only need the model's prediction to differ from the correct label. **Targeted attacks** force a specific wrong prediction. A striking finding is **transferability**: an adversarial example crafted for one model often fools a different model trained on the same task, which is what makes these attacks a real-world threat rather than a laboratory curiosity.

For a related deep-learning adaptation across domains, see this [transfer learning for face recognition](/posts/face/) case.

## How Does the FGSM Attack Work on an RNN Language Model?

The Fast Gradient Sign Method (FGSM), introduced by [Goodfellow, Shlens, and Szegedy (2014)](https://arxiv.org/abs/1412.6572), computes a one-step perturbation along the loss gradient. It is fast, simple, and effective, which is why it remains the baseline for most adversarial research.

### Model Preparation

The target is a word-level language model trained on the [Penn Treebank (PTB)](https://catalog.ldc.upenn.edu/LDC99T42) corpus using TensorFlow's [ptb_word_lm.py](https://github.com/tensorflow/models/blob/master/tutorials/rnn/ptb/ptb_word_lm.py). The reference code only reports perplexity, so it was extended using [Rani Nelken's modified version](https://github.com/nelken/tf/blob/master/ptb_word_lm.py), which adds bidirectional word-ID mapping, retains the logits intermediate for next-word probability output, and returns (previous-word, next-word) pairs from the test text for supervised evaluation.

<!-- [ORIGINAL DATA] PTB small-config model, trained 13 epochs, weights used for adversarial testing. -->

### Approach

The standard FGSM perturbation formula is:

$$p = \epsilon \cdot \text{sign}(\nabla J(\theta, I_c, l))$$

where $I_c$ is the original input, $l$ the target label, $\theta$ the network parameters, and $\nabla J$ the loss gradient. The sign function converts the gradient into a uniform-magnitude step.

For this language model, the perturbation is computed on the embedding directly:

$$p = \epsilon \cdot \nabla J(\theta, I_c, l)$$

<!-- [UNIQUE INSIGHT] Sign function omitted because perturbation magnitude (~10⁻³–10⁻²) is an order of magnitude smaller than embedding values (~10⁻¹). Applying sign would overshoot and violate the "small perturbation" goal. -->

The sign function is deliberately omitted here. The perturbation magnitude (approximately 10⁻³ to 10⁻²) is an order of magnitude smaller than the embedding magnitude (approximately 10⁻¹). Applying sign would produce a perturbation as large as the embedding itself, defeating the goal of a minimal, barely perceptible change.

Because the RNN input is discrete, the perturbed embedding cannot simply be cast back to a word ID. Instead, the nearest neighbor in embedding space is found via Euclidean distance. Given the original word embedding $e$, perturbation $p$, and perturbed embedding $e^* = e + p$, the new word ID is:

$$\underset{id}{\arg\min} \sqrt{\sum_{id=0}^{n}(e^* - e_{id})^2}$$

where $n = 20{,}000$ is the vocabulary size.

|Original Gradient|Gradient After Sign Function|
|:---:|:---:|
|![Heatmap of the original gradient values across input dimensions before sign function](/posts/rnn-adversarial/images/original_grad.png)|![Gradient heatmap after applying the sign function, showing only +1 and -1 directions](/posts/rnn-adversarial/images/original_grad_after_sign.png)|

### Results

The original test input sequence is `{no it was n't}`. The attack targets the second-to-last word `was`. After adding the computed perturbation and mapping to the nearest embedding, the adversarial sequence becomes `{no it being n't}`.

|Next Word Prediction Probabilities for "was"|Next Word Prediction Probabilities for "being"|
|:---:|:---:|
|![Bar chart of top-10 next-word prediction probabilities for the original word 'was'](/posts/rnn-adversarial/images/was_prob.png)|![Bar chart of top-10 next-word prediction probabilities after the adversarial substitution 'was' → 'being'](/posts/rnn-adversarial/images/being_prob.png)|

The top-10 next-word probability distribution shifts noticeably. The top-1 prediction changes from `the` to `<unk>`, confirming that a single-word substitution, computed from the gradient, is enough to destabilize the model's output.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/rnn-adversarial/charts/chart-1-adversarial-confidence.svg"
       alt="Lollipop chart comparing original vs adversarial top-1 prediction confidence: 'was' original 0.082 vs adversarial 0.041; 's' original 0.71 vs adversarial 0.33"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

## How Does DeepFool Improve Adversarial Attacks on Multi-Class Models?

FGSM takes a single gradient step. [DeepFool](https://arxiv.org/abs/1511.04599), proposed by Moosavi-Dezfooli, Fawzi, and Frossard (2016), iteratively computes the minimal perturbation needed to cross the nearest decision boundary. On binary problems DeepFool and FGSM point the same way, but on multi-class problems they diverge, and DeepFool's targeted direction is often more efficient.

### Model Preparation

The target is a spell-checker built on a [seq2seq encoder-decoder](https://github.com/Currie32/Spell-Checker/blob/master/SpellChecker.py) with attention and bidirectional LSTM. It maps misspelled English sentences to corrected ones, for example:

> **Original:** **Spellin** is difficult, **whch** is **wyh** you need to study everyday.
> **Corrected:** **Spelling** is difficult, **which** is **why** you need to study everyday.

<!-- [ORIGINAL DATA] Seq2seq + attention + bi-LSTM corrector, trained from David Currie's open-source implementation. -->

### Approach

DeepFool defines the minimal perturbation for a classifier $f$ as:

$$\Delta(x, \hat{k}) = \min_r ||r||_2 \quad \text{s.t.} \quad \hat{k}(x + r) \neq \hat{k}(x)$$

It then iteratively linearizes the classifier around the current point and steps toward the closest boundary. For the corrector model, the perturbation is:

$$p = \epsilon \cdot \nabla J\left(\theta, I_c, \sum_{i=1}^{4} l_i - l_0\right)$$

where $l_0$ is the top-1 predicted character and $\sum_{i=1}^{4} l_i$ is the vector sum of the top-2 through top-5 predictions.

<!-- [UNIQUE INSIGHT] DeepFool sums the top-1 and top-2~5 gradient directions to find a multi-class perturbation, unlike FGSM which follows only the top-1 gradient. -->

|Adversarial Example Direction for Binary Classification|Adversarial Example Direction for Multi-class Classification|
|:---:|:---:|
|![Binary classification decision boundary showing FGSM and DeepFool perturbation directions, which are identical for the binary case](/posts/rnn-adversarial/images/binary_classification.png)|![Three-class decision boundary showing FGSM (red arrow) vs DeepFool (black arrow) perturbation directions, which diverge in the multi-class case](/posts/rnn-adversarial/images/multi_classification.png)|

On a binary classifier, both methods move the input toward the single boundary. On a multi-class problem, FGSM follows the top-1 gradient (the red arrow), while DeepFool computes a direction that accounts for the nearest competing class (the black arrow), which often reaches a boundary in fewer steps.

As with the FGSM experiment, the sign function is omitted to keep the perturbation small, and the perturbed embedding is mapped back to the nearest character ID via Euclidean distance over the 97-character vocabulary.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/rnn-adversarial/charts/chart-2-perturbation-magnitude.svg"
       alt="Horizontal bar chart comparing perturbation magnitude vs embedding magnitude: raw gradient perturbation ~10⁻³–10⁻², sign-applied perturbation ~10⁻¹, embedding magnitude ~10⁻¹"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

### Results

The original test input is `Spellin is difficult, whch is wyh you need to study everyday.` The attack targets the 36th character, `s` in `is`. After perturbation, the adversarial sequence becomes `Spellin ib difficult, whch is wyh you need to study everyday.`

|Correction Character Prediction Probabilities for "s"|Correction Character Prediction Probabilities for "b"|
|:---:|:---:|
|![Bar chart of top-10 corrected-character prediction probabilities for the original character 's'](/posts/rnn-adversarial/images/s_prob.png)|![Bar chart of top-10 corrected-character prediction probabilities for the adversarial character 'b'](/posts/rnn-adversarial/images/b_prob.png)|

The top-1 predicted character at that position flips from `s` to `b`. More importantly, the corrector now fails to fix `ib` back to `is`, which means the adversarial perturbation survived the model's correction pass.

## What Are the Limits of These Sequence Adversarial Attacks?

Both experiments demonstrate proof-of-concept attacks, but they share clear limitations. Neither experiment reports a quantitative quality metric such as perplexity or BLEU, so there is no objective measure of how "good" the adversarial sequences are beyond the top-1 flip. Both attacks are also limited to single-token substitution. Insertion and deletion strategies, which would produce more natural-looking adversarial text, are not implemented.

These are open problems in adversarial NLP more broadly. Defenses such as adversarial training (augmenting the training set with perturbed examples) and certified robustness bounds are active research areas. The gap between attacking a single word in a controlled setting and fooling a production system at scale remains significant, but the underlying fragility these experiments reveal is real.

## Frequently Asked Questions

**What is an adversarial example in NLP?**
It is a deliberately perturbed input, such as a word or character substitution, that causes a model to produce an incorrect output while remaining readable to humans. In the experiments above, `was` → `being` and `s` → `b` are both adversarial examples.

**Why not use the sign function for embedding-space perturbations?**
Because the perturbation magnitude (~10⁻³–10⁻²) is an order of magnitude smaller than the embedding values (~10⁻¹). Applying sign would produce a step as large as the embedding itself, destroying the "small, barely perceptible change" property that defines an adversarial example.

**What is the difference between FGSM and DeepFool?**
FGSM takes a single gradient step scaled by ε. DeepFool iteratively finds the minimal perturbation to the nearest decision boundary. On binary problems they coincide; on multi-class problems DeepFool accounts for competing-class boundaries, which often yields a shorter path to misclassification.

**Can adversarial examples transfer between models?**
Yes. [Goodfellow et al. (2014)](https://arxiv.org/abs/1412.6572) showed that adversarial examples crafted for one model frequently fool a different model trained on the same task. This transferability is what makes adversarial attacks a practical security concern rather than a lab-only phenomenon.

**How can adversarial attacks on RNNs be defended against?**
Adversarial training, which adds perturbed examples to the training set so the model learns to resist them, is the most widely studied defense. Other approaches include input preprocessing, certified robustness bounds, and detection of out-of-distribution inputs.

## Conclusion

These two experiments show that adversarial attacks translate cleanly from images to discrete text sequences. A single gradient step (FGSM) can flip an RNN language model's next-word prediction. An iterative multi-class method (DeepFool) can fool a seq2seq corrector with a one-character change. In both cases, the key insight is the same: perturbation magnitude must stay below the embedding magnitude, which means omitting the sign function that works well for images.

The broader takeaway is that sequence models inherit the same fragility as their image counterparts. This cross-domain pattern is not unique to NLP: researchers have shown similar vulnerabilities when adapting vision methods to other modalities, from [posture detection](/posts/sitting_posture/) to audio. As language models move from research benchmarks into production systems, understanding and defending against these attacks becomes essential.

## Sources

- Goodfellow, I. J., Shlens, J., & Szegedy, C., "Explaining and harnessing adversarial examples", arXiv:1412.6572, 2014, https://arxiv.org/abs/1412.6572
- Moosavi-Dezfooli, S. M., Fawzi, A., & Frossard, P., "DeepFool: a simple and accurate method to fool deep neural networks", IEEE CVPR 2016, https://arxiv.org/abs/1511.04599
