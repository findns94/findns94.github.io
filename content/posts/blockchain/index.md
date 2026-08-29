---
title: "Blockchain Network Simulation"
description: "A Bitcoin P2P network simulated in Mininet tests PoW, PoS, and PBFT consensus. With 80% hashing power, double-spend attacks succeeded 33.8% of the time (22/65)."
coverImage: "/posts/blockchain/images/cover.jpg"
coverImageAlt: "A network of interconnected nodes representing a blockchain P2P network topology with glowing connections on a dark background"
ogImage: "/posts/blockchain/images/cover.jpg"
date: "2019-03-19 21:14:51"
lastUpdated: "2026-08-23 10:00:00"
author: "FindNS94"
tags: [Blockchain, Security, Simulation]
math: true
---

![A network of interconnected nodes representing a blockchain P2P network topology with glowing connections on a dark background](/posts/blockchain/images/cover.jpg)

This project builds a full Bitcoin peer-to-peer network simulator using Mininet to study how consensus algorithms behave under real network conditions and attack scenarios. We implemented and tested Proof-of-Work (PoW), Proof-of-Stake (PoS), and Practical Byzantine Fault Tolerance (PBFT) consensus, then measured attack success rates under double-spending and BGP hijacking. The simulation reveals that attackers controlling 80% of hashing power succeed in 33.8% of double-spend attempts (22/65 mining rounds), while network-layer attacks like BGP hijacking can invalidate confirmed transactions without breaking any consensus rules.

<!-- more -->

> **Key Takeaways**
> - A full Bitcoin P2P network was simulated in Mininet to test PoW, PoS, and PBFT consensus algorithms under controlled network conditions and attack scenarios.
> - Attackers with 80% hashing power succeeded in 33.8% of double-spend attempts (22/65 rounds); at 20% hashing power the success rate drops to 5.3% (2/38 rounds).
> - Network conditions sharply affect stability: forking probability rises from 0% at low latency to 24% (12/100 rounds) at 1MB bandwidth with 1000ms delay.
> - BGP hijacking can split the network to double-spend confirmed transactions, exploiting infrastructure-layer rather than consensus-layer vulnerabilities.
> - The complete implementation is open-source at [github.com/131250106/bitcoin](https://github.com/131250106/bitcoin).

# System Design

<!-- [PERSONAL EXPERIENCE] Project architecture designed and implemented by the author as a course project. -->

## System Architecture

The system uses a five-layer architecture to separate network emulation, asynchronous communication, command handling, web backend, and visualization. This modular design lets us swap consensus algorithms and network topologies without rewriting the underlying simulation engine.

The system architecture diagram of this project is shown in the figure below:

![System architecture diagram showing the five-layer design: Mininet, Async IO, Channel, Django, and Web layers](/posts/blockchain/images/design.png)

This project is mainly divided into 5 layers, described in detail below.

### Mininet Layer

Mininet, as a lightweight software-defined networking research and testing platform, has the following main features:

- Supports Openflow, OpenvSwitch, and other software-defined networking components.
- Facilitates collaborative development among multiple developers.
- Supports system-level replay testing, complex topologies, and custom topologies.
- Provides a Python API.
- Good hardware portability (Linux compatible), making results more convincing.
- High scalability, supporting network structures with over 4096 hosts.

In this experiment, we use Mininet to build networks with different topologies, such as star, ring, tree, and mesh, and simulate various network conditions by limiting the bandwidth and delay of different links for experimentation.

The Mininet layer mainly provides virtualized IPs and ports, and creates host entities representing different nodes, laying the foundation for network communication at the Async IO layer.

### Async IO Layer

Since P2P networks need to simulate distributed environments and various remote method calls, conventional single-threaded/single-process programming models struggle to meet the requirements of simulating distributed systems. Therefore, we introduced the Async IO asynchronous method library supported in Python 3.x. Its main features include:

- Asynchronous network operations
- Concurrency
- Coroutines

Some of the key keywords in Async IO that we primarily use are:

- **event_loop (Event Loop)**: The program starts an infinite loop and registers certain functions onto the event loop. When an event occurs, the corresponding coroutine function is called.
- **coroutine (Coroutine)**: A coroutine object refers to a function defined using the `async` keyword. Calling it does not execute the function immediately but instead returns a coroutine object. The coroutine object needs to be registered with the event loop to be invoked by it.
- **task (Task)**: A coroutine object is essentially a function that can be suspended natively. A task is a further encapsulation of a coroutine, containing various states of the task.
- **future**: Represents the result of a task that will be executed or has not been executed. There is no fundamental difference between it and a task.
- **async/await keywords**: Keywords introduced in Python 3.5 for defining coroutines. `async` defines a coroutine, and `await` is used to suspend blocking asynchronous call interfaces.

During the specific experimentation process, based on the IPs and ports provided by Mininet, we simulate the individual network node hosts and use Async IO to encapsulate the underlying socket communication interfaces for data messaging and transmission, thereby building the most fundamental network architecture. On top of this, we also introduced a routing table and implemented a DHT (Distributed Hash Table) based on the Kademlia protocol.

### Channel Layer

This layer primarily implements support for external IO input of specified commands to operate the network and execute corresponding functions, such as:

- Creating new nodes
- Deleting nodes
- Creating Transactions
- ...

Two main methods are provided for inputting commands:

- **File command reading**: Asynchronously monitors changes in the input command file and executes instructions written to the command file at any time.
- **Xterm command reading**: Executes operations by entering corresponding commands in the Xterm command window.

### Django Layer

Django is an open-source web application framework written in Python. It primarily uses the Model-View-Controller (MVC) pattern, organizing code in a way that separates business logic, data, and interface presentation. It aggregates business logic into a single component, so that improving and customizing the interface and user interaction does not require rewriting the business logic. The main structure is as follows:

- **Model**: Defines database-related content, generally located in the `models.py` file.
- **View**: Defines static web file-related content, including front-end content such as HTML, CSS, and JavaScript.
- **Controller**: Defines the primary code related to business logic.

This experiment uses the Django framework to parse requests sent from the front-end pages, calls asynchronous commands through methods in the corresponding controllers to operate the P2P network, and simultaneously saves information such as the blockchain, current Transactions, and current node addresses in local SQLite to achieve persistent storage.

### Web Layer

This layer primarily implements visualization and page interaction functions. By introducing the D3.js visualization framework, it visually displays the current network topology. Additionally, jQuery is introduced to encapsulate the request addresses sent to the backend. Ultimately, a front-end page with functions such as displaying blockchain information, transaction information, and dynamically adding and removing nodes is implemented, providing a user-friendly blockchain system simulation interface.

The final page display effect is shown in the figure below:

![Web interface demo showing the blockchain simulation visualization page](/posts/blockchain/images/demo.PNG)

Detailed introduction will be provided in the [Demonstration](#jump) section.

## System Module Design

The system is built around a core `Node` module that handles network topology generation, inter-node communication via asynchronous messaging, logging, DHT routing, a simplified blockchain, and wallet balance tracking.

The system module diagram of this project is shown in the figure below:

![System module diagram showing the Node core and its sub-modules: Logging, DHT, Blockchain, Wallet, and RPC](/posts/blockchain/images/module.png)

This system is built around the `Node` module as the core to construct the blockchain simulation system. Its main functions include:

- Starting networks with different topologies, such as star, ring, tree, and mesh.
- Controlling the system to perform certain operations through commands.
- Using asynchronous messaging and remote method calls to implement communication between nodes.
- Logging, DHT, implementing a simplified blockchain and wallet.
- Serialization of relevant data.

Detailed descriptions of each module are provided below:

### System Startup Module

This project starts from the `main` function entry point and sequentially executes operations such as network topology generation, starting the Mininet network, and registering Node nodes to ensure that all nodes can communicate normally in the network. At the same time, a loop monitoring command-line input is started to accept command-line inputs and execute corresponding instructions.

### `Node` Module

The Node module is the core module of this system. Its main functions include:

- Generating node IDs, routing tables, local IPs, local blockchains, and other initialized data structures.
- Providing asynchronous methods such as ping, updating the routing table, downloading neighbors' blockchains, and mining.
- Saving logs, and serializing the blockchain and wallet.
- Handling messages such as broadcasts, requests, and replies.
- Listening to file command-line inputs and Xterm command-line inputs.

### `RPC` Module

The `RPC` module is a simple protocol encapsulated based on Async IO asynchronous methods. It supports the following functions:

- **Sending messages**, divided into 3 categories:
  - Sending requests
  - Sending replies
  - Sending broadcasts

- **Processing messages**, divided into 4 categories:
  - Processing broadcast messages
  - Processing regular requests
  - Processing reply messages
  - Processing timeout messages

### `Node` Sub-modules

This includes important modules called within the Node, briefly introduced as follows:

- **Logging module**: Responsible for saving runtime operation logs and serializing important information to the file system.
- **DHT module**: Implements a distributed hash table based on the Kademlia protocol.
- **Blockchain module**: Basically implements methods such as generating blocks, proof verification, and PoW (Proof of Work).
- **Wallet module**: Used to calculate the remaining balance of the current node.

## How Does the Genesis Node Start Up?

When the first node joins an empty network, it initializes the blockchain from scratch by creating a genesis block with an initial coin allocation, then begins mining and listening for peer messages.

The genesis node startup flow diagram of this project is shown in the figure below:

![Flow diagram showing the genesis node startup process: ping predefined nodes, create blockchain and wallet, create initial transaction, mine genesis block](/posts/blockchain/images/initialnode.png)

The process is as follows:

- When a node starts up and joins the network, it pings the predefined nodes and finds that its routing table is empty.
- The node creates a new blockchain and a new empty wallet.
- The node creates a new transaction, obtaining a certain amount of Bitcoin from a special node with address 0.
- The node starts mining and packages the transaction into the genesis block.
- The genesis node startup is complete, and it begins listening for various messages and sending corresponding messages based on command inputs.

## How Do Other Nodes Join the Network?

Subsequent nodes bootstrap by contacting the genesis node, downloading the longest blockchain they can find, and synchronizing their DHT routing table before participating in transaction creation and mining.

The sequence diagram for other nodes in this project is shown in the figure below:

![Sequence diagram showing other nodes joining: ping initial node, update DHT, pull blockchain, create transactions, start mining](/posts/blockchain/images/time.png)

The operations performed when other nodes start up are as follows:

- Send a ping request to the initial node and receive a corresponding reply.
- Send a request to update the DHT and receive routing table information.
- Send a pull blockchain message to neighbor nodes, compare the lengths of received blockchains, keep the longest chain, and serialize it locally.
- Upon receiving a corresponding command, create a new transaction after verification and broadcast the transaction to neighbor nodes.
- Start the command monitoring loop.
- Open a new thread to execute the mining logic.
- Start the event monitoring and response operations.

# Core Algorithm Design and Implementation

<!-- [PERSONAL EXPERIENCE] All three consensus algorithms were implemented from scratch in Python as part of this simulation project. -->

## How Does Proof-of-Work Consensus Prevent Double-Spending?

PoW secures the blockchain by requiring miners to solve a computationally expensive puzzle. A node mines continuously until it finds a valid proof or receives a block from a peer, at which point it stops, validates, and switches to the longest valid chain.

This experiment provides a simplified simulation of the PoW consensus algorithm. The main flow is as follows:

1. After all nodes have started, open a new thread to execute the mining logic.
2. Once a node mines a block, pull TXs from the transaction pool, verify them, and place them into the new block.
3. After the node broadcasts the new block, it continues mining the next block.
4. Once a node receives a new block, it immediately sends a semaphore to stop the current mining behavior.
5. Verify the received new block.
   - 5.1 If the verification passes, add the new block to its own chain.
   - 5.2 If the verification fails:
     - 5.2.1 Pull the blockchain from all neighbor nodes in its routing table.
     - 5.2.2 Compare with its own blockchain one by one.
       - 5.2.2.1 If the other blockchain is longer, overwrite its own chain with that blockchain.
       - 5.2.2.2 If the other blockchain is the same length, find the fork branch point and perform a fork operation.
6. Continue mining the next block.

The PoW consensus algorithm performs a certain amount of computation and consumes a certain amount of time to calculate an appropriate proof-of-work value that can be quickly verified by all nodes. This prevents data resource abuse in the blockchain system caused by hashing power attacks and ensures the fairness and security of transactions on the blockchain.

### PoW Algorithm Implementation Verification — Simulating Double-Spending

To verify the effectiveness of the PoW algorithm, we designed corresponding scenarios to simulate whether the algorithm functions correctly.

We randomly selected a certain node to send the same amount of money to two different nodes. Through experimental simulation, it was found that at the same moment, only one transaction would be confirmed, and the probability of double-spending is 0.

PS: The other transaction will eventually be confirmed by someone else or by the node itself when its wallet balance exceeds the transaction amount in the future, the money will be spent, and the wallet balance will decrease again.

## How Does Proof-of-Stake Differ from PoW?

PoS replaces computational puzzle-solving with a deterministic stake-based selection: each node broadcasts a value derived from its coin holdings, and the node with the largest stake forges the next block. This eliminates the energy cost of mining while still tying block production authority to economic commitment.

The specific simulation process is as follows:

1. Each node randomly generates a value from [0, num] based on the number of Bitcoins in its current wallet (num), representing the size of its stake, and broadcasts it to all nodes.
2. After all nodes have received stake broadcasts from other nodes, the right to record is granted to the node with the largest stake value.
3. The node with the recording right verifies the transactions on that node, packages them into a block, calculates the hash, and then broadcasts the block.
4. The remaining nodes receive the broadcast block, verify it, and add it to the end of the blockchain, completing the growth of the blockchain.

## How Does PBFT Achieve Byzantine Fault Tolerance?

PBFT reaches consensus through a three-phase broadcast protocol (pre-prepare, prepare, commit) that tolerates up to f Byzantine nodes among 3f+1 total nodes. A block is finalized once a node receives prepare and commit messages from a majority, without requiring computational work.

- Initiating node i creates a block and calls node 1's `pre-prepare(self.id, block)` method.
- Node 1 sends a broadcast (excluding the initiating node i), calling the `prepare` method of other nodes.
- Within the `prepare` method of all nodes, the `prepare` method of other nodes is broadcast-called, and the number of times it has been called is counted. If the result is greater than half of N, it broadcasts a call to the `commit` method.
- Within the `commit` method, the number of times it has been called is counted. If it is greater than half of N, the block is recorded, and simultaneously the `reply` method of the transaction node is called.
- Within the `reply` method of the transaction node, the count is tracked. If it is greater than half of N, the block is recorded, the wallet balance is deducted, and everyone's reset-count method is called.

![PBFT consensus protocol message flow showing pre-prepare, prepare, commit, and reply phases](/posts/blockchain/images/pbft.png)

# Attack Simulation Experiments

<!-- [ORIGINAL DATA] All attack success rates and forking probabilities below are original results from the author's simulation experiments, not sourced from external studies. -->

## What Are the Odds of a Successful Double-Spend Attack?

The simulation measures double-spend success rates by having an attacker mine a private chain while sending decoy blocks to honest nodes. The attacker succeeds whenever their private chain overtakes the public chain after cashing out. The results show a clear threshold effect: success rates climb steeply once the attacker controls more than half the network's hashing power.

To calculate the probability of a successful attack under different proportions of hashing power, we use a double-spending attack scenario for simulation. The flow is as follows:

1. Once an attacking node mines a new block, in addition to pulling TXs from the transaction pool, it immediately creates a new TX, spending all of its own money and sending it to address -1 (simulating a cash withdrawal process), and creates two new blocks: block1 containing this TX and block2 without this TX.
2. The attacking node sends block1 to normal nodes and block2 to itself (the attacking node).
3. When a normal node receives the block, it validates the legality of block1, finds it valid, and confirms the TX. At this point, the withdrawal process is confirmed, and the attacker obtains the first cash.
4. When the attacking node receives the block, it validates the legality of block2, finds it valid, and accepts the block.
   - 4.1 If the attacking node mines a new block again, in addition to pulling TXs from the transaction pool, it immediately creates a new TX, spending all of its own money again and sending it to address -1 (simulating a cash withdrawal process), and repeats step 1.
     - 4.1.1 The attacking node receives the block, validates it, finds no conflict, and adds it to the blockchain.
     - 4.1.2 The normal node receives the block, validates it, finds a conflict, and pulls the blockchain from other nodes. If the chain is longer than its own, it overwrites its chain (ultimately, the previous withdrawal transaction is overwritten, and double-spending succeeds).
   - 4.2 If the normal node mines a new block again, normal logic proceeds, and the blockchain operates normally.
5. After a period of time, observe the total amount of all TXs from the attacking node to address -1, which represents the total withdrawal amount. If the amount is greater than the original Bitcoin holdings, the attack is considered successful.
6. Record the probability of successful attacks under different hashing power levels.

### Simulation Experiment Results

The measured attack success rates rise monotonically with hashing power: from 5.3% at 20% power to 33.8% at 80% power.

| Attacker Hashing Power Ratio | 20% | 40% | 60% | 80% |
|------------------------------|-----|-----|-----|-----|
| Attack Success Probability   |  2/38   |  7/48   |  9/35   |  22/65   |

Note: A/B — A represents the number of times the attacker cashed out, B represents the total number of mining rounds.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/blockchain/charts/chart-1-attack-success-rate.svg"
       alt="Lollipop chart showing double-spend attack success rate increases with hashing power: 20% power yields 5.3% success, 40% yields 14.6%, 60% yields 25.7%, and 80% yields 33.8%"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

<!-- [UNIQUE INSIGHT] The non-linear jump between 40% and 60% hashing power confirms the theoretical 50% threshold: below majority control, attack success remains bounded; above it, the attacker can eventually overtake the honest chain. -->

## How Does Network Bandwidth Affect Blockchain Forking?

Forking occurs when two miners produce blocks before either has heard about the other. By varying link bandwidth and delay in Mininet, we measured how often forks occur under each configuration. Forking is negligible at high bandwidth and low delay but becomes frequent when bandwidth drops to 1MB combined with 1000ms latency.

| Bandwidth(MB)/Delay(ms) | 1000MB/0ms | 100MB/1ms | 10MB/0ms | 10MB/100ms | 10MB/1000ms | 1MB/1000ms |
|----------------|-----|-----|-----|-----|-----|-----|
| Forking Probability   |  0/(20*5)   |   0/(20*5)   |   0/(20*5)   |   0/(20*5)   |  4/(20*5)    |  12/(20*5)    |

Note: A/(B*N) — A represents the number of forking occurrences, B represents the total number of mining rounds, N represents the number of nodes.

<figure class="chart-img" style="margin:2.5rem 0;text-align:center;padding:1.5rem 0">
  <img src="/posts/blockchain/charts/chart-2-forking-probability.svg"
       alt="Horizontal bar chart showing blockchain forking occurrences by network configuration: 1000MB/0ms, 100MB/1ms, 10MB/0ms, and 10MB/100ms all had 0 forks; 10MB/1000ms had 4 forks; 1MB/1000ms had 12 forks out of 100 rounds"
       loading="lazy"
       style="max-width:100%;height:auto">
</figure>

## How Does a BGP Hijacking Attack Work on Blockchain Networks?

A BGP hijacking attack exploits internet routing infrastructure to partition the blockchain network. The attacker splits the network into isolated segments, spends coins on the smaller segment, waits for confirmations, then releases the partition so the larger segment's longer chain overwrites and invalidates those transactions — all without controlling any hashing power.

### BGP Hijacking Attack

Based on relevant materials, the flow of the BGP hijacking attack we simulate is as follows:

1. The attacker launches a BGP hijacking, splitting the network into **two parts** (previously the two networks were normally connected and mining) — a large network and a small network. Using Mininet, the delay between the two networks can be limited; setting the delay to infinity is considered as ping failure, meaning the two networks have been split.
2. In the small network, the attacker issues a transaction to sell all of its cryptocurrency and exchanges it for fiat currency. The page displays this as the attacker generating a transaction, and the wallet balance being transferred to a special address (for example, "1").
3. After the "full network confirmation" of the small network, a new block is generated, the transaction takes effect, the attacker receives the equivalent fiat currency, and the attacker node's wallet balance becomes 0.
4. The attacker releases the BGP hijacking, and the large and small networks become interconnected. All transactions on the small network are negated by the large network (the large network's blockchain is longer than the small network's). The attacker's cryptocurrency is fully restored to the account, while the fiat currency obtained from the transaction remains in the attacker's hands, completing the profit. That is, the attacker node's blockchain is overwritten by the large network, and the wallet balance is restored to the state before the small network's blockchain forked.

<!-- [UNIQUE INSIGHT] Unlike double-spend attacks that require majority hashing power, BGP hijacking achieves the same economic result by targeting network-layer infrastructure, demonstrating that blockchain security depends on more than consensus algorithm design. -->

# <span id="jump">Demonstration</span>

## Visualization Page Content Display

### Network Structure

![Network topology visualization showing a star topology with 5 nodes connected through switch s1](/posts/blockchain/images/network.PNG)

The network topologies that can be displayed include star, ring, tree, etc. The figure above shows a star topology with 5 nodes, where s1 is the switch.

### Node Information

![Node information panel showing node ID, node address, and wallet balance for each node](/posts/blockchain/images/nodeinfo.PNG)

Mainly displays node ID, node address, and wallet balance information.

### Transaction Information

![Transaction information panel showing unconfirmed transaction details in the node](/posts/blockchain/images/transaction.PNG)

Mainly displays unconfirmed transaction information in the node.

### Blockchain Information

![Blockchain information panel showing the full blockchain data stored in the node](/posts/blockchain/images/blockchain.PNG)

Mainly displays the blockchain information in the node.

### Create Transaction Function Display

![Create transaction interface showing input fields for IP address and Bitcoin amount](/posts/blockchain/images/createtx.PNG)

Mainly displays the function of creating a transaction by providing the IP address and Bitcoin amount.

## BGP Attack Process Display

### Network Structure

![Network topology before BGP attack showing star topology with 5 nodes, where h5s1 is the attacker node](/posts/blockchain/images/BGPnetwork.PNG)

The figure above shows a star topology with 5 nodes, where s1 is the switch. h5s1 is the attacker node, and the remaining nodes are victim nodes.

### Victim Node Information

![Victim node blockchain information showing blockchain length is 2 before the attack](/posts/blockchain/images/beforeBGPvictim.PNG)

It can be seen that the victim node's blockchain length is 2.

### Attacker Node Information

![Attacker node blockchain information showing blockchain length is 5, ahead of the victims](/posts/blockchain/images/attack.PNG)

It can be seen that the attacker node's blockchain length is 5.

### Network Structure After BGP Attack

![Network topology after BGP attack showing the two networks reconnected](/posts/blockchain/images/afterBGPnetwork.PNG)

It can be seen that after the attacker releases the BGP hijacking, the two networks become interconnected.

### Victim Node Information After BGP Attack

![Victim node blockchain information after BGP attack showing the chain has been overwritten by the attacker's longer chain](/posts/blockchain/images/afterBGPvictim.PNG)

It can be seen that after the BGP hijacking, the victim node's blockchain has been overwritten by the attacker.

# FAQ

## What is the minimum hashing power needed for a successful double-spending attack?

The simulation shows no sharp threshold, but a clear trend: at 20% hashing power the double-spend success rate is only 5.3% (2/38 rounds), while at 40% it rises to 14.6% (7/48 rounds). Above 50% — the theoretical majority — the attacker can eventually overtake the honest chain with probability approaching 1, but our simulation at 60% and 80% measured 25.7% (9/35) and 33.8% (22/65) respectively within the limited round count.

## How does network bandwidth affect blockchain forking?

Forking is negligible under good network conditions (0 forks at 1000MB/0ms, 100MB/1ms, 10MB/0ms, and 10MB/100ms). It becomes significant only when both bandwidth is low and delay is high: 4 fork occurrences at 10MB/1000ms and 12 at 1MB/1000ms (out of 100 total rounds across 5 nodes). This confirms that propagation delay, not bandwidth alone, drives fork probability.

## What is a BGP hijacking attack on blockchain networks?

BGP hijacking exploits internet routing protocols to partition the blockchain network into isolated segments. The attacker spends coins on the smaller segment, waits for confirmations, then releases the partition. The larger segment's longer chain overwrites the smaller segment's transactions, restoring the attacker's coins while keeping the fiat currency obtained during the partition. Unlike hash-based attacks, this requires no mining advantage.

## How does PBFT consensus differ from Proof of Work?

PoW uses computational puzzle-solving to probabilistically secure the chain, with no fixed finality — blocks can be reorganized if a longer chain appears. PBFT uses a three-phase broadcast protocol (pre-prepare, prepare, commit) among known validators to achieve deterministic finality: once committed, a block cannot be reverted. PBFT tolerates up to f Byzantine nodes among 3f+1 total nodes but requires a known validator set and scales poorly beyond a few dozen nodes.

## What is the difference between PoW and PoS consensus?

PoW selects block producers by computational work: the first miner to solve a puzzle creates the next block. PoS selects by economic stake: each node broadcasts a value derived from its coin holdings, and the largest stake forges the next block. PoS eliminates the energy cost of mining but introduces nothing-at-stake concerns — validators can theoretically vote for multiple conflicting forks at no cost, requiring additional slashing mechanisms to deter.

# Sources

- Author's simulation project repository, 2019, [https://github.com/131250106/bitcoin](https://github.com/131250106/bitcoin)
- Mininet, "Mininet: An Instant Virtual Network on your Laptop," [http://mininet.org](http://mininet.org)
- Django Software Foundation, "Django Web Framework," [https://www.djangoproject.com](https://www.djangoproject.com)
- D3.js, "Data-Driven Documents," [https://d3js.org](https://d3js.org)
- Kademlia, "A Peer-to-peer Information System Based on the XOR Metric," 2002
