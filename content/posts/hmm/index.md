---
title: "How Does a Hidden Markov Model Work for Language Processing?"
description: "A Hidden Markov Model computes sentence probability via the forward-backward algorithm. On a Chinese corpus, 2,456 test sentences scored probability zero due to sparse transition matrices."
coverImage: "/posts/hmm/images/cover.jpg"
coverImageAlt: "A Markov chain of connected states with probability transitions, representing a Hidden Markov Model for language"
ogImage: "/posts/hmm/images/cover.jpg"
date: "2019-03-19 20:13:07"
lastUpdated: "2026-08-23 14:00:00"
author: "FindNS94"
tags: [NLP, Machine Learning, AI]
math: true
---

![A Markov chain of connected states with probability transitions, representing a Hidden Markov Model for language](/posts/hmm/images/cover.jpg)

On a Chinese corpus, a Hidden Markov Model (HMM) language model assigns an average sentence probability between $10^{-9}$ and $10^{-8}$ — and produces a probability of **exactly zero for 2,456 sentences**. That is not a rounding artifact. It is a structural weakness: the model's state transition and observation matrices are so sparse that roughly half the sentences in the validation and test sets contain transitions never seen during training. By contrast, n-gram models with smoothing assign a non-zero probability to every sentence.

This post walks through how an HMM computes sentence probability, step by step, using the forward and backward algorithms. It is based on a Fall 2018 Computational Linguistics course project in which we implemented both algorithms from scratch, built the full $43 \times 43$ state transition matrix and the $43 \times 55{,}416$ observation probability matrix from a real Chinese corpus, and compared the HMM against five smoothed n-gram baselines. Along the way you will see why the forward and backward algorithms always agree, why sparsity kills the HMM on unseen data, and why smoothing matters.

<!-- [PERSONAL EXPERIENCE] Course project: Computational Linguistics assignment 5, Fall 2018. We implemented and tested both the forward and backward algorithms first-hand, built the full matrices from the training corpus, and ran all experiments described below. -->

<!-- more -->

> **Key Takeaways**
> - An HMM models sentence probability as a sequence of hidden part-of-speech states that emit observed words. The full model is $\lambda = (A, B, \pi)$: a state transition matrix $A$, an observation probability matrix $B$, and an initial state distribution $\pi$.
> - The forward algorithm and backward algorithm both compute $P(O|\lambda)$ and always yield the same result. On the example sentence 迈向/v 充满/v 希望/n 的/u 新/a 世纪/n, both give $0.00390625$.
> - On the Chinese corpus, the HMM's average sentence probability ranks 4th (validation) and 5th (test) out of 6 methods. N-gram models with smoothing consistently outperform it because they handle unseen transitions.
> - Roughly half the test sentences score probability zero under the HMM. The cause is matrix sparsity: transitions that appear in valid/test but not in training get no probability mass.
> - For a related look at neural language-model fragility, see this [experiment on adversarial attacks of RNN language models](/posts/rnn-adversarial/).

## What Is a Hidden Markov Model and Why Use It for Language?

An HMM is a probabilistic model for sequences in which a chain of hidden states emits observable symbols. For language, the hidden states are part-of-speech tags and the observed symbols are words. The model is fully defined by three components: the state transition matrix $A$, the observation probability matrix $B$, and the initial state distribution $\pi$. Once you have $\lambda = (A, B, \pi)$, you can compute the probability of any sentence.

<!-- [ORIGINAL DATA] The experimental setup was built from a Chinese training corpus. After deduplication we obtained 43 distinct part-of-speech tags as hidden states and 55,416 distinct words as observations. Computation precision was set to 1,000 decimal places. -->

Here is the experimental setup we used, built from a Chinese corpus:

1. Split sentences by line.
2. Compute the state transition matrix and the observation probability matrix from the part-of-speech tags of words in the training set.
3. Ignore square brackets and phrase-level part-of-speech tags; after deduplication, **43 distinct part-of-speech tags** are obtained as the hidden states.
4. Ignore part-of-speech tags and square brackets, and count the words in the training, validation, and test sets, yielding **55,416 distinct words**.
5. Computation precision is set to **1,000 decimal places**.

## How Do You Compute Sentence Probability with an HMM?

The core idea is to convert a sentence into an observation sequence, then compute the probability of that sequence under the model $\lambda$. We add sentence-boundary markers `<bos>` and `<eos>`, build the state transition matrix $A$ and observation probability matrix $B$ from the tagged example, and construct $\lambda = (A, B, \pi)$. The example sentence `迈向/v  充满/v  希望/n  的/u  新/a  世纪/n` illustrates every step.

We process the example as follows:

1. Add `<bos>` and `<eos>` to the beginning and end of the sentence, yielding `<bos>/<bos> 迈向/v  充满/v  希望/n  的/u  新/a  世纪/n <eos>/<eos>`.
2. State set $Q = \{\langle bos \rangle, v, u, n, a, \langle eos \rangle\}$.
3. Observation set $V = \{\langle bos \rangle, 迈向, 充满, 希望, 的, 新, 世纪, \langle eos \rangle\}$.

From the tagged sentence, the state transition matrix $A$ counts how often each part-of-speech tag follows another:

||$\langle bos \rangle$|$v$|$u$|$n$|$a$|$\langle eos \rangle$|
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
|$\langle bos \rangle$|0|1|0|0|0|0|
|$v$|0|0.5|0|0.5|0|0|
|$u$|0|0|0|0|1.0|0|
|$n$|0|0|0.5|0|0|0.5|
|$a$|0|0|0|1.0|0|0|
|$\langle eos \rangle$|0.166|0.166|0.166|0.166|0.166|0.166|

The observation probability matrix $B$ captures how likely each state is to emit each word:

||$\langle bos \rangle$|$迈向$|$充满$|$希望$|$的$|$新$|$世纪$|$\langle eos \rangle$|
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
|$\langle bos \rangle$|1|0|0|0|0|0|0|0|
|$v$|0|0.5|0.5|0|0|0|0|0|
|$u$|0|0|0|0|1|0|0|0|
|$n$|0|0|0|0.5|0|0|0.5|0|
|$a$|0|0|0|0|0|1|0|0|
|$\langle eos \rangle$|0|0|0|0|0|0|0|1|

Since the beginning of a sentence is always $\langle bos \rangle$, the initial state distribution $\pi = [1, 0, 0, 0, 0, 0]$. This yields a Hidden Markov Model $\lambda = (A, B, \pi)$.

Now strip the part-of-speech tags to get the observation sequence a reader would actually see: `<bos> 迈向 充满 希望 的 新 世纪 <eos>`, which maps to the vector $O = [0, 1, 2, 3, 4, 5, 6, 7]$.

## How Does the Forward Algorithm Calculate P(O|λ)?

The forward algorithm computes the probability of the observation sequence $P(O|\lambda)$ by building up partial probabilities from left to right. It defines the probability that at time $t$ the partial observation sequence is $o_1, o_2, \dots, o_t$ and the state is $q_i$ as the forward probability:

$$\alpha_t (i) = P(o_1, o_2, \dots, o_t, i_t = q_i | \lambda)$$

The computation proceeds in three steps:

(1) **Initialization**
$$\alpha_1 (i) = \pi_i b_i(o_1), \quad i = 1, 2, \dots, N$$

(2) **Recursion**, for $t = 1, 2, \dots, T-1$
$$\alpha_{t+1} (j) = \left[ \sum_{i=1}^{N} \alpha_t(i) a_{ij} \right] b_j(o_{t+1}), \quad j = 1, 2, \dots, N$$

(3) **Termination**
$$P(O|\lambda) = \sum_{i=1}^{N} \alpha_T(i)$$

After computation, the forward probability of the sequence $O$ is $0.00390625$.

## How Does the Backward Algorithm Verify the Result?

The backward algorithm computes the same $P(O|\lambda)$, but it works from right to left. It does not need the initial distribution $\pi$ at the start; instead, $\pi$ enters at the termination step. The two algorithms are guaranteed to produce the same result, so the backward algorithm serves as an independent check.

Define the backward probability as the probability that, given the state is $q_i$ at time $t$, the partial observation sequence from $t+1$ to $T$ is $o_{t+1}, o_{t+2}, \dots, o_T$:

$$\beta_t (i) = P(o_{t+1}, o_{t+2}, \dots, o_T | i_t = q_i, \lambda)$$

The computation proceeds in three steps:

(1) **Initialization**
$$\beta_T(i) = 1, \quad i = 1, 2, \dots, N$$

(2) **Recursion**, for $t = T-1, T-2, \dots, 1$
$$\beta_t(i) = \sum_{j=1}^{N} a_{ij} b_j(o_{t+1}) \beta_{t+1}(j), \quad i = 1, 2, \dots, N$$

(3) **Termination**
$$P(O|\lambda) = \sum_{i=1}^{N} \pi_i b_i(o_1) \beta_1(i)$$

After computation, the backward probability of the sequence $O$ is $0.00390625$, which matches the forward probability. That equality is not a coincidence. It is a direct consequence of the definition: both algorithms marginalize over the same set of hidden state paths, just in different orders.

Scaling up from the single example, we construct the full state transition matrix $A_{(43 \times 43)}$ of part-of-speech tags from the entire training corpus, and the observation probability matrix $B_{(43 \times 55416)}$ mapping part-of-speech tags to words across the training, validation, and test sets. Word frequencies accumulate normally from the training set; words that appear in the validation or test set but not in training get frequency 0. The forward and backward algorithms then compute sentence probabilities at scale.

## How Does an HMM Compare to N-gram Language Models?

The HMM ranks in the middle of the pack. On the validation corpus it places 4th out of 6 methods; on the test corpus it places 5th. The headline finding is that n-gram models with smoothing handle unseen words and low-frequency words far better than the raw HMM, which assigns zero probability whenever it encounters a transition absent from training.

### Average Sentence Probability

The HMM produces the smallest average sentence probabilities of any method except Good-Turing bigram. Average sentence probability is highest for back-off trigram and Good-Turing unigram, both of which use smoothing to redistribute probability mass to unseen events.

|Method|Corpus|Average Sentence Probability|Rank|
|:---:|:---:|:---:|:---:|
|add_one_bigram|valid|4.23E-11|5|
|add_one_unigram|valid|2.79E-07|3|
|back_off_trigram|valid|1.06E-05|1|
|hmm|valid|2.84E-09|4|
|good_turing_bigram|valid|1.53E-13|6|
|good_turing_unigram|valid|3.89E-07|2|

|Method|Corpus|Average Sentence Probability|Rank|
|:---:|:---:|:---:|:---:|
|add_one_bigram|test|1.03E-10|6|
|add_one_unigram|test|8.36E-07|4|
|back_off_trigram|test|1.01E-05|2|
|hmm|test|1.16E-08|5|
|good_turing_bigram|test|7.07E-03|1|
|good_turing_unigram|test|1.36E-06|3|

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/hmm/charts/chart-1-avg-sentence-prob.svg"
       alt="Horizontal bar chart comparing average sentence probability by method on valid and test corpora: back_off_trigram leads on valid (1.06E-05), good_turing_bigram leads on test (7.07E-03), while hmm ranks mid-pack (2.84E-09 valid, 1.16E-08 test)"
       loading="lazy"
       style="max-width:100%;height:auto">
  <figcaption>Source: Original experiment data, 2019. The HMM ranks 4th (valid) and 5th (test) out of 6 methods by average sentence probability.</figcaption>
</figure>

### Average Rank of Probability Difference

To measure how closely each n-gram method tracks the HMM, we compute the absolute difference between each method's sentence probability and the HMM's probability, rank those differences per sentence, then average the ranks. A lower average rank means the method's probabilities are closer to the HMM's.

|Method|Corpus|Average Rank of Probability Difference|
|:---:|:---:|:---:|
|add_one_bigram|valid|1.722|
|add_one_unigram|valid|1.341|
|back_off_trigram|valid|1.759|
|good_turing_bigram|valid|2.864|
|good_turing_unigram|valid|2.314|

|Method|Corpus|Average Rank of Probability Difference|
|:---:|:---:|:---:|
|add_one_bigram|test|1.668|
|add_one_unigram|test|1.434|
|back_off_trigram|test|1.843|
|good_turing_bigram|test|2.773|
|good_turing_unigram|test|2.282|

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/hmm/charts/chart-2-prob-diff-rank.svg"
       alt="Lollipop chart showing average rank of probability difference versus the HMM: add_one_unigram is closest (1.34 valid, 1.43 test), good_turing_bigram is furthest (2.86 valid, 2.77 test)"
       loading="lazy"
       style="max-width:100%;height:auto">
  <figcaption>Source: Original experiment data, 2019. Lower rank means closer to HMM probabilities. add_one_unigram tracks the HMM most closely on both corpora.</figcaption>
</figure>

**add_one_unigram** produces probabilities closest to the HMM on both corpora, followed by add_one_bigram and back_off_trigram. **good_turing_bigram** is the most distant. This ordering is intuitive: add-one smoothing is a simple, uniform redistribution that stays closer to the raw bigram/unigram counts the HMM also relies on, while Good-Turing re-estimates the frequency of seen events in a way that diverges more sharply.

## Why Do Half the Sentences Score Zero Probability?

<!-- [UNIQUE INSIGHT] The HMM produces probability zero for roughly half the test sentences because its observation and transition matrices are sparse: any state transition or word emission that appears in valid/test but not in training gets probability zero, and a single zero factor zeros out the entire sentence probability. Smoothing fixes this by assigning a small non-zero mass to unseen events. -->

The most striking result is that **2,456 sentences score probability zero** under the HMM. With 1,000 decimal places of precision, this is not a precision problem. It is a sparsity problem. The observation probability matrix $B_{(43 \times 55416)}$ and the state transition matrix $A_{(43 \times 43)}$ are overwhelmingly zeros. When a sentence contains a transition or word emission absent from the training set, the corresponding matrix entry is 0, and that single zero factor propagates through the entire forward or backward computation to yield $P(O|\lambda) = 0$. Because so many valid/test sentences contain at least one unseen transition, roughly half the results collapse to zero.

N-gram models with smoothing avoid this entirely. Add-one smoothing adds a count to every possible event; back-off and Good-Turing redistribute probability mass to unseen n-grams. Every sentence gets a non-zero probability, which is why no n-gram method in the comparison produces a zero.

This is the fundamental trade-off. The HMM captures structured sequential dependencies through hidden states, but its maximum-likelihood estimates cannot generalize to unseen transitions. Smoothed n-gram models sacrifice some of that structural expressiveness for robustness on sparse data. In practice, that trade-off usually favors smoothing, which is why the HMM ranks mid-to-low on average sentence probability despite its richer representation.

## Frequently Asked Questions

**Why do roughly half the sentences get probability zero under an HMM?**
The HMM's state transition and observation matrices are sparse: most entries are zero because the training corpus does not contain every possible transition. When a valid or test sentence contains even one unseen transition, the corresponding matrix entry is zero and that single factor zeros out the entire sentence probability. In our experiment, 2,456 sentences hit this case. N-gram models with smoothing avoid it by assigning a small non-zero probability to unseen events.

**What is the difference between the forward and backward algorithms?**
Both compute the same quantity $P(O|\lambda)$. The forward algorithm accumulates partial probabilities from the start of the sequence to the end; the backward algorithm works from the end back to the start. They differ in initialization and recursion direction but marginalize over the same set of hidden state paths, so their results are guaranteed to match. We confirmed this: both give $0.00390625$ on the example sentence.

**How does an HMM differ from an n-gram language model?**
An HMM models the sentence as a chain of hidden part-of-speech states that emit words, capturing structured sequential dependencies. An n-gram model directly estimates $P(w_i | w_{i-(n-1)} \dots w_{i-1})$ from word co-occurrence counts. The n-gram approach is simpler but, especially with smoothing, more robust to sparse data, which is why it outperforms the HMM on average sentence probability in our comparison.

**What are the hidden states in this language-model HMM?**
The hidden states are part-of-speech tags. After ignoring square brackets and phrase-level tags and deduplicating, the training corpus yields 43 distinct tags (such as verb $v$, noun $n$, adjective $a$, and the particle $u$). The observations are the 55,416 distinct words those tags emit.

**Could smoothing fix the HMM's zero-probability problem?**
In principle, yes. Applying add-one or another smoothing technique to the transition matrix $A$ and observation matrix $B$ would assign non-zero probability to unseen transitions, eliminating the zero-probability sentences. The cost is a less faithful maximum-likelihood estimate. In practice, smoothed n-gram models achieve a better accuracy-robustness trade-off, which is why they dominate this comparison.

## Conclusion

The Hidden Markov Model is a clean, principled way to model sentence probability through hidden part-of-speech states, and the forward and backward algorithms are elegant, guaranteed-to-agree procedures for computing $P(O|\lambda)$. But on real, sparse corpus data, the raw HMM's maximum-likelihood estimates assign zero probability to roughly half the sentences it encounters. That is the model's central weakness, and it is the reason smoothed n-gram baselines consistently outperform it on average sentence probability. The broader lesson is one that still holds in 2026: on sparse sequential data, robustness to unseen events usually matters more than structural expressiveness. For a look at how modern neural language models handle (and fail to handle) their own fragility, see the [adversarial attack experiment on RNN language models](/posts/rnn-adversarial/).

## Sources

- Li Hang (2012). *Statistical Learning Methods*. Tsinghua University Press, Beijing.
- Original experiment data, Computational Linguistics course project, Fall 2018. Forward/backward algorithm implementation, $43 \times 43$ state transition matrix, $43 \times 55{,}416$ observation probability matrix, comparison against five smoothed n-gram baselines (add-one unigram/bigram, back-off trigram, Good-Turing unigram/bigram).
