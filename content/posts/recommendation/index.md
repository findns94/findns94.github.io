---
title: Personalized Resume Recommendation
date: 2019-02-23 20:59:16
tags: [Innovation Practice, Recommendation]
categories: [Research]
---


This system employs machine learning methods and a big data platform to train on a massive volume of job seekers' resumes. Unlike ordinary conditional filtering, this system can efficiently and accurately provide suitable and reliable talent recommendations from a big data processing perspective for IT positions that recruiters are looking to fill, reducing recruitment costs and using big data technology to bridge the gap between recruiters and outstanding talent.

Through research on massive resume data and company recruitment information, this project analyzes the characteristic features of personal resumes, companies, and company positions. From the recruiter's perspective, it conducts exploratory research centered on personalized recommendation technology to help recruiters obtain talent information in a more accurate and efficient manner. Based on this concept, a prototype system is implemented that can automatically recommend more appropriate resumes based on the characteristics of job postings.

<!-- more -->

We live in an era of information explosion. With the popularity of online job seeking, a large number of resumes are generated on the internet every day. For recruiters, the traditional manual resume screening method yields good results, yet it not only consumes significant time but also requires substantial manpower, material resources, and funding. Meanwhile, although simple conditional filtering through online systems can shorten the talent selection process, the quality of the filtered resumes remains poor and still requires human intervention. Therefore, how to improve the efficiency of talent recruitment and select the candidates that best match the job requirements from among thousands of resumes has become a hot topic of research. This project starts from the perspective of big data processing technology to study how to provide personalized recommendations of needed talents for recruiters, thereby improving recruitment efficiency and reducing operating costs.

Domestic websites such as Yun LieTou and 58 BangBang provide basic search functions for recruiters, capable of filtering based on simple requirements proposed by users. However, they cannot distinguish differences among talents, nor do they consider the recruiter's historical hiring records to make recommendations, failing to provide on-demand personalized job seeker recommendations tailored to recruiters. In terms of recommendation systems, there are quite a few successful examples both at home and abroad, such as the domestic music platforms NetEase Cloud Music and Douban FM, and foreign product recommendation systems such as Amazon's recommendation system, but none has been applied to resume recommendation. There are quite many recommendation-related papers domestically and internationally that can serve as references, though not many specifically on resume recommendation.

In recent years, the rapid development of the internet has swept across all industries at an irresistible pace, whether in the emerging mobile phone industry or even in the traditional home appliance industry. The service industry has also been significantly impacted. Due to its high-speed and high-efficiency characteristics, the internet can effectively reduce the cost of social services, as evidenced by examples such as Meituan and 58 Zhaopin. Job recruitment is a timeless topic. Under the current network environment, analyzing and extracting information from the vast amount of existing online resumes from a big data perspective can provide better solutions for recruiters and reduce the time cost of recruitment.

# Overall Project Hierarchy and Architecture

The project is implemented based on the Hadoop big data platform, adopting an overall offline incremental deployment solution. The bottom layer employs a high-performance HBase database and a MySQL database for web frontend calls. Above the databases run the Mahout talent classifier and the resume MapReduce classifier on the Hadoop platform. The middle layer is the algorithm layer, which comprehensively selects multiple classification algorithms to improve result accuracy. The business logic layer handles requests received from the frontend pages and delegates them to the appropriate backend modules. The presentation layer ensures that recruiters can conveniently and quickly select talents on this platform through a well-designed interactive interface.

![architecture](/posts/recommendation/images/architecture.PNG)

The project adopts an offline incremental architecture. The distributed cluster processes all data and results offline, and the results are piped into the MySQL database for display on the web frontend.

![architecture_2](/posts/recommendation/images/architecture_2.PNG)

## Project Modules

![module](/posts/recommendation/images/module.PNG)

## Resume Classification Process

First, a general classification for the IT industry is established, then recruitment requirements across various domains and categories are collected as a corpus. Next, the keywords for each category are calculated, and finally the classification result for each resume is computed.

![resume_classify](/posts/recommendation/images/resume_classify.PNG)

## Talent Classifier Process

First, 1.06 million resumes stored in the MySQL database are vectorized to obtain a 10-dimensional vector for each resume. From these, 1,300 resumes are extracted for manual labeling, with 1,000 used as the training set and 300 as the test set. A Mahout logistic regression classifier is used to generate a talent binary classification model. This model is used to determine whether each resume is a "talent" and its talent probability. The resulting output adds two attribute columns to each resume for the frontend page to call. Resumes are then sorted by the display order based on their talent probability.

![talent_classify](/posts/recommendation/images/talent_classify.PNG)

# Recommendation System

## System Flow

The system's general flow is as follows: first, determine the candidate set for the input job requirements and find resumes suitable for this job description (JD). Then, look up the historical hiring records of the company corresponding to this JD, compute the data center vector of historically hired personnel, and find the resumes most similar to those historically hired by the company within this range. Finally, sort the output results by talent probability.

![system](/posts/recommendation/images/system.PNG)

## Data Preparation

1. Classification: Classify the corresponding text.
   The previously developed classification program can be used directly.
2. Corresponding personnel: Process all resumes corresponding to (company, category) tuples.
   Map-Reduce: Take the resume data as input and obtain its (company, category) tuple along with the resume id. Insert this data into a new table (company table), with the row key as the company, the column name as the category, and the value as the resume id.
3. Candidate set: Assign categories to the resumes.
   Map-Reduce: Take the resume data as input, with the key being the resume content and the value being the resume category. The value is calculated in the Mapper, and the category attribute is added to the resume.
4. Talent probability: Use the talent classifier to add a "talent probability" attribute value to each resume.
   Algorithms on Mahout are used to train and produce a recommended model, from which the talent probability is derived.

## Algorithm Detailed Flow

1. Determine the classification for the JD.
2. Compute the data center of the corresponding people (the vectors of resumes of people who previously held the same category position at the company).
3. Identify the candidate set: all resumes related to the category of the JD.
   Map: Use the category attribute to identify all resumes of the same category. The output key is the category, and the value is the resume id.
4. Use the data center to compute the top 100 resumes in the candidate set with the highest similarity.
   Reduce: Using the resume id obtained in the previous step and the data center computed earlier, calculate the distance between each resume and the data center. The key is the distance and the value is the resume id, achieving a sorted-by-distance effect, and extract the top 100 resumes.
5. Perform talent assessment on the resumes in the candidate set (pre-processed), and sort each resume by talent probability.
6. Output the resume list to the web page for display.

# Web Interface

## Homepage

The following shows the homepage display.

![index](/posts/recommendation/images/front_page.png)

## Job Posting Page

The following shows the job posting page display.

![job_info](/posts/recommendation/images/job_info_1.png)
![job_info](/posts/recommendation/images/job_info_2.png)

## Candidate Recommendation Page

The following shows the candidate recommendation page display.

![recommendation](/posts/recommendation/images/recommend.png)

## Resume Detail Page

The following shows the resume detail page display.

![detail](/posts/recommendation/images/detail.png)
