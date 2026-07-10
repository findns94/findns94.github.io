---
title: Detecting Improper Sitting Posture with a Laterally Positioned Motion-sensing Camera
date: 2019-02-22 20:00:00
tags: [Sitting Posture, Innovation Practice, Paper]
categories: [Research]
---


**Abstract** Sitting posture detection is helpful for preventing musculoskeletal disorders. With the development of motion-sensing cameras and related software development kits (SDKs), it is possible to implement an application using skeleton detection technology. In this paper, a method is introduced to detect sitting posture from a lateral view without disturbing the user. To analyze video stream information, a skeleton thinning algorithm is described, and an averaging process is used to specifically locate the main joints from the lateral side. The results show this method has high accuracy when detecting improper sitting postures.
**Keywords** Ergonomics; Motion-sensing Camera; Gesture Recognition; OpenNI

<!-- more -->

# Introduction

Incorrect sitting posture is considered a danger to adolescent body growth. Prolonged sitting with improper posture can cause a series of health problems. Previous research has pointed out the following consequences: the prevalence of back pain among children and adolescents; musculoskeletal discomfort and low back pain; biomechanical, circulatory, and visual problems; awkward postures adopted for extended periods of time affect academic performance[1].
In industrialized countries, musculoskeletal disorders are a significant health problem. In modern society, the most common examples are disorders in the back, shoulder, and neck. According to a report conducted by the National Institute for Occupational Safety and Health (NIOSH)[2], there is strong evidence that low-back musculoskeletal disorders and neck-and-shoulder musculoskeletal disorders are related to prolonged and improper sitting postures. Angela et al.[3] found that occupational groups exposed to awkward postures while sitting have an increased risk of suffering from low back pain.
People have developed some approaches and implementations to reduce the potential harm resulting from incorrect sitting posture. Using a motion-sensing camera is helpful for detecting sitting posture in real time. Both the depth and three-dimensional coordinate information of the body can be obtained from the motion-sensing camera. Based on OpenNI and NiTE, the Portable Ergonomic Observation (PEO) model is applied to improper sitting posture detection. After analyzing video stream data and performing image processing, a threshold method is established to locate the main joints such as the neck and head. With these joint positions and medical research, improper sitting postures can be detected and defined.

# Related Work

## Artificial observation

Professionals use illustrations, photography, or text descriptions to record sitting postures for further analysis. Since 1974, this kind of method has been fully developed, including Priel's method[4], the Ovako Working Posture Analyzing System[5], the Posture Targeting Method[6], and the Posture Recording Model[7].

## Video recording analysis

This method employs computers or video recording equipment to record a user's postures and movements. Then a computer is used to analyze the user's postures. Some implementations support real-time monitoring. Methods of this kind include the Rapid Upper Limb Assessment (RULA)[8], Rapid Entire Body Assessment (REBA)[9], Hand-Arm-Movement Analysis method (HAMA)[10], and Quick Exposure Check method (QEC)[11].

## Wearable sensors

Specialized sensors need to be placed on the user's body to collect information about sitting postures. The sensors include sitting posture sensors, electromyography (EMG) telemetry instruments, tri-axial accelerometers, and skin-mounted electromagnetic tracking sensors[12][13].

# Hardware and Software

With the development of 3D motion-sensing cameras, a real-time image processing method can be implemented. PrimeSense, an Israeli company acquired by Apple Inc. in 2013, developed the range camera technology used in the first generation of Kinect[14]. The OpenNI framework is an open-source SDK used for the development of 3D sensing middleware libraries and applications[15]. The PrimeSense NiTETM is the most advanced and robust 3D computer vision middleware. The algorithms utilize the depth and color information received from the hardware device, which enables them to perform functions such as separation of users from the background and accurate tracking of user skeleton joints[16].

Fig. 1 shows the OpenNI SDK architecture.
Fig. 2 shows a motion-sensing camera.
Fig. 3 shows the body joints tracked by the OpenNI framework.

|Fig. 1: SDK architecture[15]|Fig. 2: motion-sensing camera|Fig. 3: Body joints tracked by OpenNI framework[17]|
|:---:|:---:|:---:|
|![SDK](/posts/sitting_posture/images/SDK.png)|![motion_sensing_camera](/posts/sitting_posture/images/motion_sensing_camera.png)|![body_joints](/posts/sitting_posture/images/body_joints.png)|

# Detecting Improper Sitting Posture

## Lateral view of the user

Fig. 4 shows the experimental setup. The advantage of this setup is that the camera's view is not blocked by the desk. The following experiments are based on this setup.

|Fig. 4: Detect from the lateral side of the user|Fig. 5: Definition of hand position, neck and trunk flexion[18]|
|:---:|:---:|
|![lateral_side](/posts/sitting_posture/images/lateral_side.png)|![definition](/posts/sitting_posture/images/definition.png)|

## Applying the PEO Model

### Preparation

The camera is placed on the table, 1.0 meter above the ground. The user sits on a chair, about 2.0 meters away from the camera. Make sure that the entire body appears within the camera's view.

### Main skeleton and joints

From the PEO model, Fig. 5 shows the definition of hand position, along with neck and trunk flexion. It can be seen that the effective joints are among the trunk, neck, and head. By observing the body's forward posture, thresholds are chosen for the neck and head to determine whether the sitting posture is awkward or not.
Therefore, an ideal healthy sitting posture needs to be defined. According to the research of O'Sullivan et al.[8], there are few differences between the subjectively perceived ideal posture and the tester-perceived neutral posture. Therefore, this model uses the parameters of the PEO model.
This method focuses on neck flexion. Based on observations, humans tend to bend their neck when their body leans forward. Thus, neck flexion can reflect the body's posture.

### Analyzing the video stream

#### Finding an active user in a specific scene

Thanks to the OpenNI and NiTE APIs, the user can be separated from the background and all the data about the user can be obtained. At first, the tester needs to move a few steps in front of the camera. Once their body is being tracked, the area being tracked is monitored steadily. The user sits on the chair, and detection begins.
The resolution of the video stream is 320×240. Each pixel has its own coordinate in the frame and a depth property. The accuracy of the depth can reach one millimeter. The depth refers to the distance between the pixel in the real world and the camera. Fig. 10 shows the four detection steps, which are introduced below.

![four steps](/posts/sitting_posture/images/four_steps.png)
<div align="center">Fig. 6: Four steps of detection</div>

#### Skeleton thinning algorithm

An algorithm is designed here to reduce the area of the body to a consecutive curve. The curve consists of the head and neck, which can be located in the next step.
The coordinate of the upper-left corner of the frame is set to (0,0), and the lower-right corner of the frame is set to (320, 240). All pixels are checked in each frame row by row. After encountering a part of the body, each row of pixels is reduced to 1–2 pixels. In order to draw a consecutive curve, the pixels being marked must be adjacent to the pixels in the previous row. Fig. 8 shows the flow chart of the algorithm. Fig. 7 shows the simulation process of the thinning algorithm. Fig. 7 (a) shows the input of the algorithm. The green area refers to the body. Fig. 7 (b) shows all the midpoints of each row marked as a blue triangle in the green area. Based on the adjacency rule, the yellow triangle would be marked. Fig. 7 (c) shows the result (yellow pixels) after the algorithm is completed.

|(a) Input|(b) Mark the pixels|(c) Output|
|:---:|:---:|:---:|
|![input](/posts/sitting_posture/images/input.png)|![mark pixel](/posts/sitting_posture/images/mark_pixel.png)|![output](/posts/sitting_posture/images/output.png)|

<div align="center">Fig. 7: Example of skeleton thinning algorithm</div>

|Fig. 8: Skeleton thinning algorithm|Fig. 9: Averaging process|
|:---:|:---:|
|![skeleton thinning](/posts/sitting_posture/images/skeleton_thinning.png)|![averaging process](/posts/sitting_posture/images/averaging_process.png)|

#### Averaging process

Because the user's head is perpendicular to the direction of the camera, the user's arm is closer to the camera than the head through observation.
Considering the depths of the thinning line of the body, the depths of the head area change steadily. The depths of the arm area are lower than the depths of the head area because the arm is closer to the camera than the head. To locate the pixels that generate abrupt changes in depth, an averaging process is applied to handle this.
Fig. 9 shows the flow chart of the averaging process. The first 20 rows of pixels have the possibility of being mixed with the background. These pixels are skipped to avoid errors caused by inaccurate depth in adjacent pixels. The depths of the next 10 rows of pixels are averaged as the average depth of the head. The depth of the next pixel continues to be averaged until the depth meets an abrupt change (−60).
Fig. 10 shows the trends of raw depth and depth after the averaging process. Fig. 11 shows the trends of the raw depth difference and the depth difference after the averaging process. There is no abrupt change in the raw depth difference. The abrupt change happens between the 53rd and 68th pixels, where the depth difference is less than −40. Combining this with observation, −60 is chosen as the threshold for an abrupt change, meaning the 57th pixel is approximately the neck.
Then, the midpoint between the neck and the first pixel on the consecutive curve is chosen to identify the position of the head. The midpoint is also on the curve. The number of pixels skipped and averaged is based on the distance between the camera and the user and the effect of detection. Thus, the first 20 pixels are skipped.

|Fig. 10: Depth from top to bottom|Fig. 11: Difference in depth from top to bottom|
|:---:|:---:|
|![depth](/posts/sitting_posture/images/depth.png)|![difference](/posts/sitting_posture/images/difference.png)|

#### Threshold

Chaffin and Kilbom found that there is strong evidence showing a positive correlation between musculoskeletal disorders and neck flexion over 20°[19]. With the positions of the neck and head, the flexion angle is defined as α which can be calculated as follows:

$$\alpha = \arctan{\left| \frac{x_{neck}-x_{head}}{y_{neck}-y_{head}} \right|}$$

OpenNI provides two different coordinate systems—depth coordinates and world coordinates. Depth coordinates are the native data representation. World coordinates superimpose a more familiar 3D Cartesian coordinate system on the world, with the camera lens at the origin[20]. Here, the coordinates of the neck and head are converted from depth coordinates and world coordinates to obtain x_neck, y_neck, x_head, and y_head.
Once α exceeds 20°, the user is alerted to correct their sitting posture by means of sound. Upon hearing the alarm, the user should understand that their sitting posture is improper and should sit up straight. When α is below 20°, the sitting posture fits the health indicators, so detection continues without disturbing the user.

# Test and Evaluation

Fig. 4 shows the experimental environment. One volunteer was invited to perform a set of sitting postures. To test the accuracy of the method, the test includes 200 different improper sitting postures. There is no significant difference in the time required to complete body tracking among the tests. Based on identifying the joints and applying the threshold method, the results of the test are shown in Table 1.

<div align="center">Table 1. TEST RESULT OF DETECTING SITTING POSTURE</div>

| Total number of improper sitting postures | Number of detected improper sitting postures | Number of undetected improper sitting postures |
| :---: | :---: | :---: |
| 200 | 188 | 12 |

In order to determine whether factors such as body shape and clothing affect the accuracy of the detection, five volunteers were invited to participate in the tests. The volunteers repeated assuming an improper sitting posture 50 times. The results are shown in Table 2.

<div align="center">Table 2. TEST RESULT OF DIFFERENT FACTORS</div>

| Type of factor | Height and weight | Total number of improper sitting postures | Number of detected improper sitting postures|
| :---: | :---: | :---: | :---: |
| Fat | 180cm 105kg | 50 | 50 |
| Thin | 174cm 62kg | 50 | 48 |
| Tall | 180cm 55kg | 50 | 48 |
| Short | 165cm 50kg | 50 | 47 |
| Thin clothes | 170cm 70kg | 50 | 50 |
| Thick clothes | 170cm 70kg | 50 | 47 |

# Conclusion

This paper presented a system aimed at detecting improper sitting posture using motion-sensing camera technology. The system includes a skeleton thinning algorithm, an averaging process, and a threshold method. Detecting improper sitting posture provides a way to prevent musculoskeletal disorders. The experiment shows that this method can function efficiently and is invariant to the user's clothing and body shape.

# References

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
