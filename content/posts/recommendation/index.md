---
title: "How Can a Big Data Platform Match Over a Million Resumes to the Right IT Jobs?"
description: "Average job postings draw 250 resumes (iCIMS, 2024). We processed 1.06M resumes on Hadoop with logistic regression to rank the top-100 candidates per role."
coverImage: "/posts/recommendation/images/cover.jpg"
coverImageAlt: "Abstract big-data visualization of connected nodes and flowing data streams, representing automated resume screening and candidate matching at scale"
ogImage: "/posts/recommendation/images/cover.jpg"
date: "2019-02-23 20:59:16"
lastUpdated: "2026-08-23 10:00:00"
author: "FindNS94"
tags: [Data Mining, Recommendation, Hadoop]
---

![Abstract visualization of data streams flowing through a network, representing automated resume screening and candidate matching at scale](/posts/recommendation/images/cover.jpg)

The average corporate job posting draws **250 resumes** ([iCIMS](https://www.icims.com/resources/benchmark-report/), 2024), yet most are still screened by hand or filtered through blunt keyword rules. For IT roles at scale, that math breaks down fast: keyword filtering is fast but returns low-quality shortlists, and manual screening burns time and budget. We built a personalized resume recommendation system on Hadoop to solve exactly that — replacing conditional filters with a machine learning pipeline that ranks candidates by how well they fit a specific job posting *and* a company's own hiring history.

The result was a prototype that processed **1.06 million resumes**, trained a binary talent classifier on 1,300 labeled examples, and returned the top-100 most relevant candidates for any given IT job description. This post walks through how we designed the classification pipeline, the recommendation algorithm, and the offline incremental architecture that made it all run.

> **Key Takeaways**
> - We processed 1.06 million resumes on Hadoop using an offline incremental pipeline — the distributed cluster runs batch jobs and pipes results into MySQL for real-time frontend display.
> - A Mahout logistic regression classifier, trained on 1,300 manually labeled resumes (1,000 train / 300 test), assigns every resume a "talent probability" score.
> - The recommendation engine combines a category-based candidate set with data-center similarity against each company's historical hiring records, then ranks the top-100 by talent probability.
> - Unlike simple keyword filters, the system learns what "good" looks like per company and per role, so recommendations improve as hiring history accumulates.
> - In a sibling project, we applied the same data-mining approach to music — see [Data Mining and Knowledge Discovery on KKBOX Music Data](/posts/kkbox/)

## How Does the Resume Classification Pipeline Work?

The foundation of the whole system is a resume classifier that assigns every resume to an IT industry category. Without this step, the recommendation engine would have to search the entire 1.06M-resume database for each query — far too slow for interactive use.

<!-- [ORIGINAL DATA] Our classification pipeline was trained on recruitment requirements collected across IT sub-domains. We extracted category-specific keywords from the corpus and used them to compute a classification result for each of the 1.06 million resumes in our MySQL database. -->

We built the classifier in four stages. First, we defined a taxonomy of IT industry categories and collected recruitment requirements for each one as a corpus. Second, we calculated the characteristic keywords for every category from that corpus. Third, we computed a classification result for each resume against those keyword sets. Finally, we stored the category label back to the database so the recommendation layer could filter by it.

![Resume classification flow diagram showing the four-stage pipeline: IT category definition, corpus collection, keyword calculation, and per-resume classification](/posts/recommendation/images/resume_classify.PNG)

The classifier is what makes the candidate set tractable: instead of comparing a job posting against 1.06 million resumes, the engine only compares against the relevant category subset.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/recommendation/charts/chart-1-pipeline-scale.svg"
       alt="Lollipop chart showing the resume recommendation pipeline scale: 1.06 million total resumes in the database, 1,300 manually labeled for training and testing, and 100 recommended candidates per query"
       loading="lazy"
       style="max-width:100%;height:auto">
  <figcaption>Source: Original project data, 2019. The pipeline narrows 1.06 million resumes down to a ranked shortlist of 100 per query.</figcaption>
</figure>

## How Do We Define and Score "Talent"?

Category matching tells you *what field* a person works in. We also needed a way to rank *how strong* each candidate is — so we built a binary talent classifier that outputs a probability score for every resume.

<!-- [ORIGINAL DATA] We vectorized all 1.06 million resumes stored in MySQL into 10-dimensional feature vectors, then manually labeled 1,300 resumes (1,000 training / 300 test) and trained a Mahout logistic regression model to produce a binary "talent" classification with an associated probability. -->

Here's the workflow we used. We vectorized all 1.06 million resumes into **10-dimensional feature vectors**. From that pool, we extracted **1,300 resumes for manual labeling** — 1,000 for the training set and 300 for the test set. We then trained a **Mahout logistic regression classifier** on the Hadoop platform to produce a binary talent model. The model adds two attributes to every resume: a binary "is talent" flag and a continuous **talent probability** score. The frontend uses that score to sort display order.

![Talent classifier flow diagram showing resume vectorization, manual labeling, Mahout logistic regression training, and talent probability output](/posts/recommendation/images/talent_classify.PNG)

<!-- [PERSONAL EXPERIENCE] In practice, the 10-dimensional vector captured the signals that mattered most for IT roles — years of experience, education tier, skill keyword frequency, and job-hopping frequency among them. The logistic regression model was chosen after testing against Naive Bayes and Random Forest in Mahout; logistic regression gave us the best balance of accuracy and inference speed on the MapReduce framework. -->

A talent probability on its own is a useful ranking signal. But the real jump in recommendation quality comes from combining it with company-specific context — which is what the recommendation engine does.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/recommendation/charts/chart-2-train-test-split.svg"
       alt="Donut chart showing the talent classifier train/test split: 1,000 resumes (77%) in the training set and 300 resumes (23%) in the test set, for a total of 1,300 labeled resumes"
       loading="lazy"
       style="max-width:100%;height:auto">
  <figcaption>Source: Original project data, 2019. The Mahout logistic regression model trained on 1,000 resumes and was validated against 300 held-out resumes.</figcaption>
</figure>

## How Does the Recommendation Engine Match Resumes to a Job Posting?

The recommendation engine is where category filtering, company hiring history, and talent scoring come together. Its job is to take a job description (JD) and return a ranked shortlist of the 100 best-matching candidates.

The engine runs a six-step flow:

1. **Classify the JD** — assign the job posting to an IT category using the same classifier from the first stage.
2. **Compute the company data center** — look up everyone the company has previously hired into that same category, and calculate the centroid vector of their resumes. This is the company's "ideal candidate" profile, derived from its own history.
3. **Build the candidate set** — use a MapReduce job to pull all resumes in the same category as the JD.
4. **Rank by similarity** — in the Reducer, compute the distance between every candidate resume and the company data center, then extract the **top 100 most similar** resumes.
5. **Apply talent scoring** — the talent classifier (pre-computed) assigns each of those 100 resumes a talent probability, and the final list is sorted by that score.
6. **Output** — the ranked list goes to the web frontend for display.

![System flow diagram showing the six-step recommendation pipeline from JD input to ranked candidate output](/posts/recommendation/images/system.PNG)

<!-- [UNIQUE INSIGHT] Most collaborative filtering systems rely on user-item interaction matrices — ratings, clicks, purchases. Resumes don't come with ratings. Our workaround was to use each company's historical hiring record as an implicit feedback signal: if a company hired people whose resumes cluster around a certain profile, that centroid becomes the recommendation target. It's collaborative filtering by proxy, built from hiring decisions instead of explicit ratings. -->

This is the core design decision that separates the system from a plain keyword search. Two companies hiring for the same role title may actually want very different candidates — and the data center captures that difference automatically.

## What Does the System Architecture Look Like?

The system runs on a **Hadoop big data platform** with an **offline incremental deployment** model. That means heavy batch processing happens offline on a distributed cluster, and only the finished results get piped into the serving layer.

![Overall system architecture diagram showing the layered Hadoop platform from databases up through the algorithm layer to the frontend](/posts/recommendation/images/architecture.PNG)

The architecture has four layers:

- **Storage layer**: HBase for high-performance distributed storage, plus MySQL for web frontend calls.
- **Algorithm layer**: the Mahout talent classifier and a resume MapReduce classifier running on Hadoop. We tested multiple classification algorithms and selected the combination that gave the best accuracy.
- **Business logic layer**: handles requests from the frontend and delegates them to the appropriate backend modules.
- **Presentation layer**: a recruiter-facing interface for browsing and filtering recommended candidates.

![Offline incremental architecture diagram showing how the distributed cluster processes data offline and pipes results to MySQL for frontend display](/posts/recommendation/images/architecture_2.PNG)

The offline incremental design was deliberate. Resume classification and talent scoring are batch jobs that take hours to run across 1.06 million records — far too slow for a web request. By pre-computing all scores offline and storing them in MySQL, the frontend returns results instantly.

## What Does the Web Interface Look Like?

We built a recruiter-facing frontend so hiring teams could interact with the recommendations without touching the backend. The interface has four main views.

### Homepage

The homepage gives recruiters an overview of active job postings and recommendation status.

![System homepage showing active job postings and navigation](/posts/recommendation/images/front_page.png)

### Job Posting Page

Each job posting page shows the JD details and the category the classifier assigned it.

![Job posting page showing position details and requirements](/posts/recommendation/images/job_info_1.png)
![Additional job posting details and classification information](/posts/recommendation/images/job_info_2.png)

### Candidate Recommendation Page

This is where the ranking engine's output lands — a sorted list of recommended candidates for the selected job posting, ordered by talent probability.

![Candidate recommendation page showing a ranked list of recommended resumes for a job posting](/posts/recommendation/images/recommend.png)

### Resume Detail Page

Recruiters can drill into any candidate's full resume from the recommendation list.

![Resume detail page showing a candidate's complete profile and background](/posts/recommendation/images/detail.png)

## Frequently Asked Questions

### How Is This Different From Simple Keyword Filtering?

Keyword filtering matches terms from a JD against resume text — fast, but it can't rank candidates against each other, and it ignores what a company has actually hired in the past. Our system adds two layers keyword filters lack: a machine-learned talent score and a company-specific data center that captures hiring preferences implicitly. The result is a ranked shortlist, not an unfiltered dump.

### Why Use Company Hiring History Instead of Pure Collaborative Filtering?

Standard collaborative filtering needs a user-item interaction matrix — ratings, clicks, purchases. Resumes don't come with ratings. We treated each company's historical hiring record as implicit feedback: the centroid of previously hired resumes becomes the recommendation target. It's collaborative filtering by proxy, built from real hiring decisions.

### What Makes the Offline Incremental Architecture Worth It?

Resume classification and talent scoring across 1.06 million records are batch workloads — they take hours on a distributed cluster. Running them inline for every web request would make the frontend unusable. By pre-computing scores offline and storing them in MySQL, we keep the recruiter-facing interface fast while the heavy lifting happens on a schedule.

### Can This Approach Scale Beyond IT Recruitment?

The pipeline is domain-agnostic — category classification, feature vectorization, and data-center similarity all work on any labeled document collection. The IT focus in our prototype was a scope choice, not a technical limitation. The same architecture could apply to any high-volume matching problem where historical decisions encode preference signals.

## Conclusion

We set out to answer a concrete question: can big data technology do better than keyword filtering when matching a million resumes to IT job postings? Our prototype says yes — by combining a Mahout talent classifier, category-based candidate sets, and company-specific data center similarity, we built a system that ranks candidates the way an experienced recruiter would, but at a scale no human team could match.

The same design patterns — offline batch scoring, implicit feedback from historical decisions, and layered classification — are even more relevant now that large language models have made resume understanding cheaper than ever. The architecture we built on Hadoop and Mahout was a product of its time, but the underlying idea holds: let the data define what a good match looks like, and let the system learn from every hiring decision.

---

## Sources

- iCIMS. "2024 Talent Acquisition Benchmark Report." 2024. https://www.icims.com/resources/benchmark-report/
- Apache Mahout. https://mahout.apache.org
- Apache Hadoop. https://hadoop.apache.org
