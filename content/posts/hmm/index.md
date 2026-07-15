---
title: Hidden Markov Language Model
date: 2019-03-19 20:13:07
tags: [NLP, Machine Learning]
categories: [Course]
math: true
---


This post is a summary of the 5th assignment for the Fall 2018 Computational Linguistics course, with the task of using a `Hidden Markov Model` to calculate sentence probabilities.

<!-- more -->

# Experimental Setup

1. Split sentences by line.
2. When computing the state transition matrix and the observation probability matrix, consider the part-of-speech tags of words in the training set.
3. Ignore square brackets and phrase-level part-of-speech tags; after deduplication, 43 distinct part-of-speech tags are obtained as the hidden states.
4. Ignore part-of-speech tags and square brackets, and count the words in the training, validation, and test sets, yielding 55,416 distinct words.
5. Computation precision is set to 1000 decimal places.

# Process of Computing Sentence Probability with a Hidden Markov Model

Using the example `迈向/v  充满/v  希望/n  的/u  新/a  世纪/n`, the following processing is performed:

1. Add `<bos>` and `<eos>` to the beginning and end of the sentence, yielding the new sentence `<bos>/<bos> 迈向/v  充满/v  希望/n  的/u  新/a  世纪/n <eos>/<eos>`
2. State set $Q={\langle bos \rangle ,v,u,n,a,\langle eos \rangle}$
3. Observation set $V={\langle bos \rangle,迈向,充满,希望,的,新,世纪,\langle eos \rangle}$

From the new sentence, the state transition matrix $A$ is obtained as follows:

||$\langle bos \rangle$|$v$|$u$|$n$|$a$|$\langle eos \rangle$|
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
|$\langle bos \rangle$|0|1|0|0|0|0|
|$v$|0|0.5|0|0.5|0|0|
|$u$|0|0|0|0|1.0|0|
|$n$|0|0|0.5|0|0|0.5|
|$a$|0|0|0|1.0|0|0|
|$\langle eos \rangle$|0.166|0.166|0.166|0.166|0.166|0.166|

Similarly, the observation probability matrix $B$ is obtained as follows:

||$\langle bos \rangle$|$迈向$|$充满$|$希望$|$的$|$新$|$世纪$|$\langle eos \rangle$|
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
|$\langle bos \rangle$|1|0|0|0|0|0|0|0|
|$v$|0|0.5|0.5|0|0|0|0|0|
|$u$|0|0|0|0|1|0|0|0|
|$n$|0|0|0|0.5|0|0|0.5|0|
|$a$|0|0|0|0|0|1|0|0|
|$\langle eos \rangle$|0|0|0|0|0|0|0|1|

Since the beginning of a sentence is always $\langle bos \rangle$, the initial state distribution $\pi = [1,0,0,0,0,0]$.
This yields a `Hidden Markov Model` $\lambda = (A,B,\pi)$

Suppose the observation sequence after removing part-of-speech tags (which can be regarded as sentences in the validation and test sets) is `<bos> 迈向 充满 希望 的 新 世纪 <eos>`, which can be converted to the vector $O=[0,1,2,3,4,5,6,7]$

## Forward Algorithm

The forward algorithm can yield the probability of the observation sequence $P(O|\lambda)$.
Define the probability that at time $t$ the partial observation sequence is $o_1,o_2,…,o_t$ and the state is $q_i$ as the forward probability, denoted

$$\alpha_t (i)=P(o_1,o_2,…,o_t,i_t=q_i |\lambda)$$

The computation process is as follows:
(1) Initialization
$$\alpha_1 (i)={\pi}_i {b}_{i} ({o}_{1} ),    i=1,2,…,N$$

(2) Recursion, for $t=1,2,…,T-1$
$$\alpha_{t+1} (i)=[\sum_{j=1}^{N}\alpha_{t} (j) {a}_{ji} ] b_{i} (o_{t+1} ),    i=1,2,…,N$$

(3) Termination
$$P(O│\lambda)=\sum_{i=1}^{N}[{\alpha}_{T} (i) ]$$

After computation, the forward probability of the sequence $O$ is obtained as $0.00390625$

## Backward Algorithm

Similarly, the backward algorithm can also yield the probability of the observation sequence $P(O|\lambda)$. The difference is that the initial state distribution $\pi$ is not needed at the beginning of the computation, but is instead introduced at the termination step.

Define the probability that, given the state is $q_i$ at time $t$, the partial observation sequence from $t+1$ to $T$ is $o_{t+1},o_{t+2},…,o_{T}$ as the backward probability, denoted

$$\beta_{t} (i)=P(o_{t+1},o_{t+2},…,o_{T} |i_{t}=q_{i},\lambda)$$

(1) Initialization

$${\alpha}_{1} (i)={\pi}_{i} {b}_{i} ({o}_{1} ),    i=1,2,…,N$$

(2) Recursion, for $t=T-1,T-2,…,1$

$${\beta}_{t} (i)=\sum_{j=1}^{N}[{a}_{ij} {b}_{j} ({o}_{t+1}) ] {\beta}_{t+1} (j),    i=1,2,…,N$$

(3) Termination

$$P(O│\lambda)=\sum_{i=1}^{N} {\pi}_{i} {b}_{i} ({o}_{1}) {\beta}_{1} (i)$$

After computation, the backward probability of the sequence $O$ is obtained as $0.00390625$, which matches the forward probability, verifying that the two probabilities are equal.

Based on the example computed above, one can construct the state transition matrix $A_(43 \times 43)$ of part-of-speech tags from all training corpus, as well as the observation probability matrix $B_{43 \times 55416}$ from part-of-speech tags to words in the training, (stripped of part-of-speech tags) validation, and test sets (word frequencies in the training set are accumulated normally, while frequencies of newly appeared words in the validation and test sets are 0). The forward algorithm and the backward algorithm are then used to compute sentence probabilities.

# Comparison and Analysis of N-gram Language Model Results

## Hidden Markov Model Results

In this experiment, the forward algorithm and the backward algorithm were implemented and tested. Since the results produced by these two methods are identical, a single 1.txt was submitted. The following observations can be drawn from the submitted 1.txt:

1. Overall, the sentence probabilities split by line are quite small, with average sentence probabilities on the order of ${10}^{-9}$ to ${10}^{-8}$. Extremely small probabilities sometimes occur, for example on the order of ${10}^{-281}$.
2. There are 2456 sentences with a probability of 0. Considering the computation precision is already very high (1000 decimal places places retained), the reason may lie in the fact that the observation probability matrix and the state transition matrix of the Hidden Markov Model are excessively sparse, with most elements being 0. The model has poor capability to handle state transitions that appear in the validation and test sets but not in the training set. Therefore, the cases where the final computed probability is 0 account for roughly half of the results.

In contrast, the `n-gram` language model experiment, which employed various smoothing methods, handles new words and low-frequency words in the validation and test sets well, and no sentence with a probability of 0 occurred.

## Comparison of Hidden Markov Model Results and N-gram Language Model Results

### Average Sentence Probability

|Method|Corpus|Average Sentence Probability|Sentence Probability Ranking|
|:---:|:---:|:---:|:---:|:---:|
|add_one_bigram|valid|4.23E-11|5|
|add_one_unigram|valid|2.79E-07|3|
|back_off_trigram|valid|1.06E-05|1|
|hmm|valid|2.84E-09|4|
|good_turing_bigram|valid|1.53E-13|6|
|good_turing_unigram|valid|3.89E-07|2|

|Method|Corpus|Average Sentence Probability|Sentence Probability Ranking|
|:---:|:---:|:---:|:---:|:---:|
|add_one_bigram|test|1.03E-10|6|
|add_one_unigram|test|8.36E-07|4|
|back_off_trigram|test|1.01E-05|2|
|hmm|test|1.16E-08|5|
|good_turing_bigram|test|7.07E-03|1|
|good_turing_unigram|test|1.36E-06|3|

If most words in a sentence have a relatively high probability, then the sentence probability obtained via $P(w_1,w_2,…,w_n )=\subseteq_{i=2}^{N} P({w_i} | w_{i-(n-1) }…w_{i-1})$ (the `n-gram` approach) will also be high, and the differences in probability between different sentences will be more pronounced.

Therefore, from the table above, it can be seen that the average sentence probability computed by the `Hidden Markov Model` is at a medium-to-low level, ranking 4th (validation corpus) and 5th (test corpus) respectively. This reflects, from a side perspective, that the `Hidden Markov Model` has average adaptability to the validation and test corpus, or in other words, the `Hidden Markov Model` built from the training corpus does not have high confidence when predicting sentences in the validation and test corpus that did not appear in the training set.

### Average Rank of Probability Difference

For each sentence $S_j$ in the set, 5 `n-gram` model approaches compute probabilities $p_0,p_1,p_2,p_3,p_4$ respectively. Each is subtracted from the `Hidden Markov Model` probability $p_{hmm}$ and the absolute value is taken ($|p_{hmm}-p_i |$). These differences are then ranked to obtain the ranks $r_0,r_1,r_2,r_3,r_4$. The ranks for all sentences are then averaged for each `n-gram` model as $\frac{\sum_{j=1}^{n}{r}_{ij}}{n}$ to obtain the average rank of probability difference compared to the `Hidden Markov Model`, as shown in the two tables below:

|Method|Corpus|Average Rank of Probability Difference|
|:---:|:---:|:---:|
|add_one_bigram|valid|1.722009569|
|add_one_unigram|valid|1.340669856|
|back_off_trigram|valid|1.758851675|
|good_turing_bigram|valid|2.864114833|
|good_turing_unigram|valid|2.314354067|

|Method|Corpus|Average Rank of Probability Difference|
|:---:|:---:|:---:|
|add_one_bigram|test|1.667934783|
|add_one_unigram|test|1.43423913|
|back_off_trigram|test|1.842934783|
|good_turing_bigram|test|2.773369565|
|good_turing_unigram|test|2.281521739|

In summary, the probabilities obtained by the `add_one_unigram` method are closest to those obtained by the `Hidden Markov Model`, followed by the `add_one_bigram` method, then the `back_off_trigram` method, then the `good_turing_unigram` method, while the probabilities obtained by `good_turing_bigram` are the most distant from those obtained by the `Hidden Markov Model`.

# References

[1] Li Hang (2012). Statistical Learning Methods. Tsinghua University Press, Beijing.
