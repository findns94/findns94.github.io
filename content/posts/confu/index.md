---
title: Multithreaded Concurrency Defect Detection for JVM Applications
date: 2019-02-28 23:27:41
tags: [Concurrency, JVM, Testing]
categories: [Research]
---


Currently, with the rapid development of multi-core computer hardware, multithreaded concurrent programs are gaining increasing popularity and widespread adoption. However, due to the hidden nature of shared memory space access and the randomness of concurrent thread scheduling, multithreaded programs are highly susceptible to concurrency defects, which are often difficult to detect and reproduce. Existing concurrency defect detection methods all have their limitations; for example, methods based on system testing and symbolic execution cannot scale to large concurrent programs due to state space explosion, while methods based on probabilistic scheduling have a very low defect hit rate.

To address the enormous challenges faced in concurrent program testing today, the DATE team developed DATE-Confu, a multithreaded concurrency defect detection tool for JVM applications based on dynamic program testing techniques. The tool takes JVM executable programs under test (.class files or .jar files) as input and outputs the set of concurrency defects detected in the program. Currently, the tool can detect six categories of serious concurrency defects, including data races, deadlocks, and null pointer dereferences. Users can select which types of concurrency defects to detect based on their needs.

The key innovation of DATE-Confu lies in its effective combination of guided schedule fuzzing techniques and symbolic trace analysis techniques. The figure below shows the architecture diagram of DATE-Confu. The tool uses fuzzing techniques to efficiently traverse the enormous state space of multithreaded programs, while the symbolic trace analysis techniques rapidly discover unexplored control branches in the program under test, thereby providing effective information for iterative fuzzing and enabling DATE-Confu to reach higher coverage faster. DATE-Confu has so far been tested on multiple industrial-level projects. The experiments conducted to date have demonstrated that DATE-Confu achieves high testing efficiency and is capable of uncovering deeper-hidden concurrency defects.

<!-- more -->

![confu_architecture](/posts/confu/images/confu_architecture.jpg)
<div align="center">DATE-Confu Architecture Diagram</div>

This tool won second place in the Software Prototype Competition (Topic-based Category) at the 2017 National Conference on Software and Applications (NASAC 2017). NASAC has been organizing prototype system exchanges since 2008. Starting from 2013, the Software Engineering Committee and the Systems Software Committee officially co-organized the "Software Research Prototype Competition." The NASAC 2017 prototype competition was the first to feature self-proposed topics by the contest, where contestants prepared their tools and conducted testing and reporting live at the competition site. A total of 8 software tools passed the initial review and advanced to the final round, and the judging committee, composed of experts from both industry and academia, selected the first, second, and third prize winners.

# Instrumentation

The DATE-Confu tool uses the ASM bytecode instrumentation framework to implement its instrumentation functionality. ASM is a framework for operating on Java bytecode files. Generally, the bytecode manipulation process for an ordinary Java file involves 3 steps:

- Compile Java source code to obtain Java bytecode;
- Use ASM's ClassReader to read the bytecode, use the visitor pattern to modify the bytecode, and then use ClassWriter to generate new bytecode;
- Load the new bytecode into the JVM for execution.

The overall instrumentation process is divided into two parts. The first part is where the DATE-Confu tool uses the Java Agent pattern to instrument the Java bytecode of the detection algorithms. The second part is when, upon detecting that the bytecode of the module under test needs to be loaded into the JVM at runtime, the Transform method in the Agent is invoked again to intercept the bytecode of the module under test. After instrumentation is complete, the instrumented bytecode is loaded into the JVM for execution. At that point, the bytecode running on the JVM invokes the detection algorithms in DATE-Confu to perform defect detection.

![ASM](/posts/confu/images/ASM.jpg)
<div align="center">Bytecode Instrumentation Flow</div>

During the instrumentation process, specific bytecode instructions need to be selected for processing to avoid instrumenting common Java modules, which would produce unnecessary output. For example, modules included in the JDK are excluded within the Agent's Transform method. Typically, the targets for instrumentation are the bytecode under test and the bytecode introduced by other packages that the bytecode under test depends on. Therefore, it is necessary to ensure that the bytecode in packages closely related to the bytecode under test can be found on the runtime classpath, or to use the command-line parameter for excluding specified classes to avoid instrumenting designated classes.

# Thread Scheduling

The essence of fuzz testing multithreaded programs is to introduce randomness into thread scheduling. The current general approach is to construct a high-level scheduler below the underlying operating system; this scheduler controls scheduling by forcibly performing context switches. Typically, context switches are implemented by introducing operations such as sleep and priority changes.

In the DATE-Confu tool, we use priority change operations to achieve low-overhead context switches while avoiding the introduction of deadlocks. To generate diverse thread schedulings, most existing techniques implement fuzz testing at the event level. Event-level fuzz testing means randomly inserting scheduling operations before or after a specific event to achieve context switchover—for example, inserting a sleep instruction before every memory write operation in a multithreaded program can cause different threads to interleave when executing memory writes. However, due to the large number of events in real-world applications, event-level fuzz testing results in a relatively low probability of hitting defects.

To address the low defect-hit probability of event-level fuzz testing, we proposed using Memory Access Group (MAG) technology to optimize fuzz testing during scheduling when developing the DATE-Confu tool. The core idea of Memory Access Group technology is to group consecutive memory accesses and perform fuzzy testing on the scheduling within each group, which can effectively narrow the scheduling state space and increase the probability of hitting defects. However, optimization using only Memory Access Group technology is not sufficient for us to more effectively generate defect-triggering traces. To enable the thread scheduling module to more efficiently locate concurrency defects in programs, we propose a randomized fuzz testing technique based on Memory Access Group technology. This technique models the fuzzing process as a search problem and introduces the Monte Carlo Markov Chain (MCMC) method to optimize the search in order to obtain optimal search solutions.

# FastTrack Algorithm

The most fundamental detection algorithms for data races are the Happens-Before and Lockset detection algorithms. With further research, researchers have continuously optimized and improved upon these two classic algorithms, giving rise to the commonly used algorithms today. The FastTrack algorithm used by the DATE-Confu tool is an optimized version of the Happens-Before algorithm for efficiently detecting data race concurrency defects. The basic idea of the Happens-Before algorithm is to record every shared memory access and then check whether it has a Happens-Before relationship with the previous access; if no such relationship exists, a data race is reported. The basic idea of FastTrack is similar. However, FastTrack incorporates many improvements that effectively enhance both the time complexity and space complexity of the algorithm.

Through observing a large number of programs, we can see that among data race detection operations, thread synchronization operations account for a small proportion compared to read/write operations, with read/write operations comprising as much as 96%. The key to FastTrack's effectiveness lies in the fact that 99% of read/write operation monitoring does not require full vector clocks; instead, it uses a more lightweight data structure. FastTrack discusses the three cases of data races separately: write-write races, write-read races, and read-write races.

# NPD Detection Algorithm

The algorithm used in DATE-Confu to detect null pointer dereferences. Null pointer dereference defects can be referenced against the detailed description in CWE 476. The NPD detection algorithm relies on: (1) concurrency partial-order relation identification; and (2) memory sampling. The algorithm flow is summarized as follows:

1. Dynamically load the bytecode of the program under test
2. Instrument the bytecode, inserting memory sampling interfaces based on different JVM bytecode instructions. For example, for the PUTFIELD instruction, the stack top elements are {value, objectref}, representing the value written to memory and the object reference, respectively. At this point, the memory sampling interface captures the value and maintains it in the algorithm.
3. Execute the program under test to generate runtime traces
4. Dynamically identify Happens-Before relations to determine whether specific operations in different threads (such as memory accesses, lock/unlock operations, etc.) have strict concurrency partial-order relations, i.e., Happens-Before relations
5. Dynamically intercept memory access operation pairs ($x_1$, $x_2$) that do not satisfy Happens-Before relations, ensuring that $x_1$ and $x_2$ consist of one write operation and one read operation
6. In the intercepted memory operation pairs ($x_1$, $x_2$), check whether the corresponding memory access values are null. If a value is null, it indicates that in the concurrent runtime environment, due to concurrency non-determinism, a null object reference may occur, causing the program to crash

The NPD algorithm can be seen as an extension and refinement of the FastTrack algorithm, used for automatically locating null pointer dereference problems that may be triggered during concurrent operations. As shown in the figure, when the program is accessed by multiple threads, the NPD detection algorithm can automatically capture two concurrent memory access pairs: `(executor!=null, executor=null)` and `(executor.start(), executor=null)`, and through memory sampling, determine that `(executor.start(), executor=null)` may trigger a null pointer dereference problem.

![ASM](/posts/confu/images/npd.png)
<div align="center">Null Pointer Dereference Problem</div>

# GoodLock Detection Algorithm

In multithreaded programs, when every thread in a thread collection is waiting for an exclusive resource held by another thread, the resulting circular wait is called a deadlock. Among all concurrency defects, deadlocks are relatively common. Once a deadlock occurs, it may lead to increased response time, decreased throughput, or even crash and downtime of the multithreaded program, seriously threatening the availability and reliability of concurrent programs. Like other concurrency defects, deadlocks have the characteristics of being difficult to expose, reproduce, and debug.

The DATE-Confu tool detects deadlock concurrency defects primarily by implementing the GoodLock algorithm. The GoodLock algorithm can detect whether a concurrent program under test is likely to experience deadlock at runtime. The algorithm mainly makes its determination by constructing lock trees. The current GoodLock algorithm can handle deadlock problems among any number of threads. The algorithm connects the lock trees of individual threads to form a lock graph and traverses all possible paths to find valid cycles, thereby determining whether the program is likely to deadlock. In addition, the GoodLock algorithm combines runtime detection with static analysis, implementing a new type system on the foundation of previous work. It can not only detect deadlock problems in Java programs but also provide stronger atomicity guarantees.
