---
title: Formal Verification of Smart Contracts
date: 2019-04-22 22:41:57
tags: [Blockchain, Security, Formal Verification]
categories: [Course]
math: true
---


A smart contract is a code contract and algorithmic contract that will become a foundational technology of the future digital society. It utilizes protocols and user interfaces to complete all steps of the contractual process. This article summarizes the main technical characteristics of smart contracts as well as existing trustworthiness and security issues, and proposes applying formal methods to the modeling, model checking, and formal verification of smart contracts to support the generation of large-scale smart contracts.

<!-- more -->

Ethereum is an open-source public blockchain platform with smart contract functionality [1][2]. Through its dedicated cryptocurrency, Ether, it provides a decentralized virtual machine (called the "Ethereum Virtual Machine") to process peer-to-peer contracts.

Ethereum's most important technical contribution is the smart contract. A smart contract is a program stored on the blockchain that can assist with and verify the negotiation and execution of contracts. Ethereum's smart contracts can be written in several Turing-complete programming languages [3]. The Ethereum platform is a public computer operated by a network of many users, and uses Ether to allocate and pay for the right to use this computer [4]. Smart contracts enable databases of numerous organizations to interact at low cost, and allow users to write sophisticated contracts. One of their functions is to create Decentralized Autonomous Organizations (DAOs), which are virtual companies constituted solely by Ethereum contracts [5].

Because contract contents are public, contracts can prove that their claimed features are genuine — for example, a virtual casino can prove it is fair [6]. On the other hand, the public nature of contracts also means that if a vulnerability exists in the contract, anyone can immediately see it, while fixing the code may take some time [7]. The DAO is an example of an incident that could not have been stopped in real time [8].

The DAO: DAO stands for Decentralized Autonomous Organization. The DAO was, at the time, the world's largest crowdfunding project built on the Ethereum blockchain platform. Its purpose was to allow holders of The DAO tokens to collectively decide on investment projects through voting. The entire community was fully self-governing, implemented through smart contracts written in code. The DAO raised 11.7 million Ether (worth approximately $245 million), setting a record in crowdfunding history.

However, on June 17, 2016, The DAO's smart contract running on the Ethereum public chain was attacked. Funds raised by the contract were continuously redirected to the attacker's sub-contract through a recursive call to a single function, involving an amount equivalent to over 3 trillion New Taiwan Dollars. Many details of smart contracts are still under study, including how to verify the functionality of contracts, how to perform large-scale analysis on published contracts, and how to discover and identify vulnerabilities within contracts.

Since The DAO is an open-source project running on Ethereum, its code was published on the Ethereum platform. Focusing on the security vulnerabilities in The DAO smart contract's transaction scenario, we used the NuSMV modeling language to abstract and model the process. We then verified the model using NuSMV, successfully identifying the security vulnerability in the smart contract's transaction scenario. Subsequently, we fixed the smart contract at the model level for this vulnerability, then used NuSMV to verify the model again, and ultimately found that the vulnerability had been accurately repaired.

# Problem Description

## Analysis of The DAO Transaction Flow

![image](/posts/dao-validation/images/dao_process.PNG)

The figure above shows the main flowchart of the attack on The DAO:

1. First, the attacker creates a new contract within The DAO.
2. Then, using this contract, the attacker initiates a split request to splitDAO:
By design according to the white paper, the original intent of splitDAO was to protect the minority who are at a disadvantage during voting, preventing them from being exploited by the majority through legitimate voting. By splitting out a small-scale DAO, they are given the mechanism of "voting with their feet," while still ensuring they can receive any potential returns from external funding made before the split.
3. Once splitDAO approves the split request, it creates a childDAO (if one does not already exist) and transfers the Ether owned by the splitter into the childDAO (this is currently the only viable mechanism for withdrawing Ether).
4. Finally, the child token is returned to the original contract, so that the person who proposed the split request gains access to the newly split childDAO.

Up to this point, the four steps above seem to proceed without any abnormalities. However, the real crisis begins the moment Ether is transferred into the childDAO in step 3. Below, we look at how splitDAO specifically transfers Ether in the third step.

![image](/posts/dao-validation/images/dao_process_2.PNG)

3.1 splitDAO first checks whether the proposer's ID is valid and whether the proposer has voted in favor (through the normal process of steps 1 and 2, the attacker's verification information can easily pass). After the check is passed, splitDAO initiates a withdraw request and calls the withdraw function.
3.2 Subsequently, the withdraw function calculates the amount of Ether to be transferred through a series of computations, and then calls the payout function.
3.3 According to The DAO's design, the payout function first calls the user-defined callback function in the original contract (similar to notifying the user that the split request is complete and allowing them to perform some custom operations). Then it proceeds to execute step 3.4: **calling the actual Payout function (which performs the real transfer functionality; it is an internal function with no external interface and is an atomic operation)**.

Under normal flow, execution should follow the sequence of 3.1, 3.2, 3.3, and 3.4 in order as described above, after which the transfer succeeds and everything proceeds normally.
However, the problem arises precisely at the user-defined callback function: in the custom callback function, the attacker calls splitDAO again and initiates a withdraw operation. This causes the normal flow to become 3.1, 3.2, 3.3, 3.5 (with 3.4 pushed onto the stack), 3.1, 3.2, 3.3, 3.5... repeating endlessly until the callback stops the 3.5 process and ceases calling splitDAO. Then, the multiple instances of the 3.4 Payout transfer operations that were pushed onto the stack will be executed repeatedly, and the attacker's account acquires a large amount of Ether out of thin air.

# State Machine of The DAO Transaction Flow

To use NuSMV to model and verify the process described above, we first need to abstract and model the transaction flow mentioned above. Considering that state machine models have a high degree of compatibility with NuSMV models, we first abstract the flow into state machines of three different modules: the user module, the contract module, and the splitDAO module.

## Main State Machine of the User Module

![image](/posts/dao-validation/images/user_state.PNG)

For the User module, it primarily contains 4 important states: an initialization state where the user account is 0, and both the created contract and splitDAO are in their initial states. Subsequently, when a user in the initialization state initiates a split request, splitRequest is set to true, the contract state becomes split_contract, and after splitDAO receives the request, it splits into the childDAO state while the contract state is updated to child_contract. Finally, after splitDAO completes all Payout operations, it returns the control token child_token of childDAO (setting it to true) and simultaneously changes the user's account to 12 Ether, while the states of new_contract and splitDAO are both updated to end.

## Main State Machine of the Contract Module

![image](/posts/dao-validation/images/contract.PNG)

For the contract module, it similarly contains 4 most significant states: the initial state where Ether is set to 10 and the contract state is new_contract. When the contract initiates a split_proposal request, the splitRequest state is set to true and the contract state is set to split_contract. After splitDAO creates the new childDAO, the child_token is set to true while the contract state is set to child_contract. Finally, the contract initiates a withdraw request, adds revenue to the Ether to update it to 12, and then sets the contract state to end.

## Main State Machine of the splitDAO Module

Since NuSMV does not support function calls, to simulate the behavior of a function call stack, we created a custom stack module. Its main state machine is shown in the figure below:

### Stack Module State Machine Diagram

![image](/posts/dao-validation/images/stack.PNG)

When the received operation is a push operation, the stack stores the current state into the function_stack array and increments the corresponding pointer counts by 1. When the operation is pop, it returns the state pointed to by the pointer in the function_stack array and decrements the pointer counts by 1. When the operation is relax, the state remains unchanged.

### splitDAO Core State Diagram

![image](/posts/dao-validation/images/splitDao_core.png)

The initial state of splitDAO has a voting count votingNum of 0. When a contract initiates a split request, the voting count increases by 1 accordingly. When the number of votes reaches a certain threshold (we assume 20 here), splitDAO begins the split operation. After splitDAO initiates the split request, the time now increments continuously by 1. According to The DAO's design, one must wait 7 days before the split operation takes full effect. After that, a new childDAO is created and the access control token child_token is set to true and returned to all split requesters.

After that, splitDAO needs to transfer the Ether from the original contract to the new childDAO and calculate the reward value of the entire contract, transferring it together to the childDAO. Therefore, splitDAO initiates a withdraw request and sets its state to withdraw_reward_for. Here, it first checks whether paidout is less than reward (this step is very important and will be discussed in detail later). If the condition is satisfied, it calls the payout method.

In the payout method, it first calls the userFunction defined in the user's original contract (the callback function), and then immediately calls the actual transfer function Payout. If the callback function recursively calls splitDAO, then each invocation of Payout by payout pushes it onto the stack. When the recursion ends, the actual transfer tasks in the stack are executed sequentially. Here, we simulate this process using our custom simple stack: before each callback invocation, the operation is set to push, pushing the PayOut operation onto the stack. When the callback no longer calls splitDAO, the operation is set to pop, and the PayOut operations in the stack are then popped out and executed sequentially.

Finally, after all PayOut operations have been executed, the value of account is accumulated many times over, and splitDAO sets the paidOut value to paidOut + reward.

Additionally, it is worth noting that The DAO introduced the concept of gas:

Contract execution is repeated across all nodes, which makes the cost of contract execution expensive and encourages keeping computations off the blockchain whenever possible. Each executed command has a specific cost, counted in units of gas. Each command available to a contract has a corresponding gas value.

Every transaction is required to include a gas limit. If the transaction, due to computation — including the original message and any triggered additional messages — requires a gas amount less than or equal to the set gas limit, the transaction will be processed. If the total gas consumption exceeds the gas limit, all operations are reverted, but the transaction is considered valid and the transaction fee is still collected by the miner. The blockchain will show that the transaction completed its attempt, but since insufficient gas was provided, all contract commands were reverted. Any excess gas that was not used in the transaction is returned to the transaction initiator in the form of Ether.

Therefore, to avoid running out of gas, the attacker, in the custom callback function, recursively calls the splitDAO function within a certain limit on gas (we assume gas = 10 here).

# Vulnerability Fix

By analyzing the flow of the splitDAO critical state machine, we can easily identify the problem:

First, in the withdraw function, before calling payout, the system compares the value of reward with the value of paidOut to avoid calling payout more than once. And after the actual PayOut function is executed, the value of reward is indeed added to paidOut.

However, the attacker's cleverness lies in exploiting the call stack mechanism by recursively calling splitDAO's withdraw function. Because the previously executed PayOut function is still in the stack and has not been executed, the paidOut value has not changed, allowing the check in the withdraw function to pass naturally. This ultimately results in multiple recursive transfers.

Once this mechanism is understood, fixing this issue becomes very simple:
The only change needed is to update the paidOut value before calling the payOut function, rather than after it.
With just this small change, even if the callback function recursively calls splitDAO's withdraw function, the function's check mechanism will detect that the paidOut value has already changed and is no longer less than reward, indicating that payout has already been called. Thus, it will not recurse again, and this vulnerability is resolved.

# NuSMV Modeling Process

## Attribute Overview

| main module | Type | Meaning |
|:---:|:---:|:---:|
| gas | integer; | Energy; transaction stops when it reaches 0 |
| user | user | User, owns a contract, receives energy as a parameter |

| User Module | Type | Meaning |
|:---:|:---:|:---:|
| account | integer | Balance of the user's account |
| splitRequest | boolean | Request to split the contract |
| child_token | boolean | Flag indicating permission to withdraw funds |
| new_contract | contract | Contract |
| split_dao | splitDAO | The process of splitting out a child DAO |

| contract module | Type | Meaning |
|:---:|:---:|:---:|
| ETH | integer | Ether, the currency on the Ethereum platform |
| states | enumeration | State of the contract; available states are new_contract, split_contract, child_contract, and end |
| directions | enumeration | Direction of contract transition; available values are initiating a split request, withdrawing funds, and staying in the current state |

| stack module | Type | Meaning |
|:---:|:---:|:---:|
| counts | integer | Records the current depth of the stack |
| function_stack | array | Stack constructed using an array; values include callback_function and PayOut, representing the callback function and payment respectively |

| splitDao module | Type | Meaning |
|:---:|:---:|:---:|
| votingNum | integer | Number of votes |
| votingFloor | integer | Minimum threshold for vote passing |
| votingDeadline | integer | Voting deadline |
| now | integer | Current date |
| operation | enumeration | Stack operation; values are stackpush, stackpop, and relax, representing push, pop, and no-op respectively |
| pushStates | enumeration | Elements pushed onto the stack; values include callback_function and PayOut, representing the callback function and payment respectively |
| popStates | enumeration | Elements popped from the stack; values include callback_function and PayOut, representing the callback function and payment respectively |
| states | enumeration | State |
| paidout | integer | Accumulated earnings |
| reward | integer | Revenue obtained through contract splitting |
| functionStack | stack | Stack structure |
| accumulatedInput | integer | Variable for calculating the reward |
| totalSupply | integer | Variable for calculating the reward |
| balanceOf | integer | Variable for calculating the reward |

## Process Description

Based on the state machine models of the three modules introduced in the second section, we translated them into NuSMV models; see the code for specific implementation details. We then set the NuSMV assertion: **SPEC AG !(user.new_contract.ETH > 12)**;
to determine whether the attacker has successfully exploited the vulnerability to obtain extra Ether.
Following the standard procedure, a user performing a split operation should receive the principal of 10 Ether plus the original contract revenue of 2 Ether, totaling 12 Ether. Therefore, if at any point in the process the user's Ether becomes greater than 12 Ether, it indicates that the smart contract has a vulnerability.
We then use the NuSMV verification command to verify the model.

## Verification Results

Through the process described above, the model verification results from NuSMV are as follows:

```bash
-- specification AG !(user.new_contract.ETH > 12)  is false
-- as demonstrated by the following execution sequence
Trace Description: CTL Counterexample
Trace Type: Counterexample
  -> State: 1.1 <-
    gas = 15
    user.account = 0
    user.splitRequest = FALSE
    user.child_token = FALSE
    user.new_contract.ETH = 10
    user.new_contract.states = new_contract
    user.new_contract.directions = stay
    user.split_dao.votingNum = 0
    user.split_dao.votingFloor = 20
    user.split_dao.votingDeadline = 7
    user.split_dao.now = 0
user.split_dao.operation = relax
…
  -> State: 1.31 <-
    user.split_dao.now = 8
    user.split_dao.states = withdraw_reward_for
  -> State: 1.32 <-
    user.split_dao.now = 9
    user.split_dao.reward = 2
  -> State: 1.33 <-
    user.split_dao.now = 10
    user.split_dao.operation = stackpush
    user.split_dao.states = payOut
 …
  -> State: 1.57 <-
    user.splitRequest = FALSE
    user.new_contract.ETH = 14
    user.new_contract.directions = split_proposal
    user.split_dao.votingNum = 23
    user.split_dao.paidout = 4
    user.split_dao.functionStack.counts = 3
```

The results indicate that a vulnerability indeed exists in the model, causing the user to obtain extra Ether.

## Fix Procedure and Re-verification

Based on the fix solution analyzed in the second section regarding the vulnerability fix, we changed the paidout value from:

```bash
next (paidout):=
            case
                states = PayOut & paidout<90 : paidout + reward;
                TRUE:paidout;
            esac;
```

to:

```bash
next (paidout):=
            case
                states = payOut & paidout<90 : paidout + reward;
                TRUE:paidout;
            esac;
```

To verify that our modification not only fixes the previous vulnerability but also allows the smart contract to continue proceeding according to its original design — meaning that even if an attacker writes anomalous attack code, the normal business logic will still provide them with the normal amount of Ether.

Therefore, we added another NuSMV assertion: **SPEC AG !(user.new_contract.ETH = 12)**

to determine whether, after the overall flow is completed, the user's contract balance is 12 Ether.

The modified model verification results are shown below:

```bash
-- specification AG !(user.new_contract.ETH > 12)  is true
-- specification AG !(user.new_contract.ETH = 12)  is false
-- as demonstrated by the following execution sequence
Trace Description: CTL Counterexample
Trace Type: Counterexample
  -> State: 1.1 <-
    gas = 15
    user.account = 0
    user.splitRequest = FALSE
    user.child_token = FALSE
user.new_contract.ETH = 10
…
  -> State: 1.36 <-
    user.split_dao.operation = stackpop
    user.split_dao.states = withdraw_reward_for
  -> State: 1.37 <-
    user.split_dao.operation = relax
    user.split_dao.states = PayOut
    user.split_dao.functionStack.counts = 0
  -> State: 1.38 <-
    user.new_contract.ETH = 12
    user.new_contract.directions = split_proposal
    user.split_dao.states = end
```

The results indicate:

1. The vulnerability existing in the original The DAO transaction flow has been successfully fixed.
2. The fixed model can operate according to the expected normal flow.

# Summary

In this experiment, by reading the open-source code of The DAO on Ethereum, we understood the transaction flow containing the vulnerability. We then converted this flow into a state machine model with a high degree of similarity to NuSMV. Finally, through NuSMV's model checking functionality, we successfully reproduced the security vulnerability issue in The DAO's smart contract.

Lastly, we performed a fix at the model level for the vulnerability in The DAO, then used NuSMV to test the fixed model again. The final verification results demonstrate that: we successfully fixed the original security vulnerability without breaking the normal logical flow.

Through The DAO verification example, we can see that there indeed exist trustworthiness and security issues in smart contracts, and that formal methods can be well applied to the full lifecycle verification of smart contracts. A good model checking tool helps inspect and verify various properties of smart contracts, thereby ensuring their security.

# References

[1]	Gray, Jeff. Bitcoin believers: Why digital currency backers are keeping the faith. The Globe and Mail (Phillip Crawley). 7 April 2014 [17 February 2016].

[2]	Vigna, Paul. BitBeat: Microsoft to Offer Ethereum-Based Services on Azure. The Wall Street Journal (Blog). News Corp. 28 October 2015 [17 February 2016].

[3]	Jon, Evans. Vapor No More: Ethereum Has Launched. techcrunch.com. [25 February 2016].

[4]	Nathaniel Popper for the New York Times. March 27, 2016 Ethereum, a Virtual Currency, Enables Transactions That Rival Bitcoin's.

[5]	The great chain of being sure about things. The Economist. 31 October 2015 [4 May 2016].

[6]	Piasecki, Piotr J. Gaming Self-Contained Provably Fair Smart Contract Casinos. Ledger. 2016, 1: 99–110. doi:10.5195/ledger.2016.29.

[7]	Peck, M. Ethereum's 150-Million Blockchain-Powered Fund Opens Just as Researchers Call For a Halt. IEEE Spectrum. Institute of Electrical and Electronics Engineers. 28 May 2016.

[8]	Popper, Nathaniel. Hacker May Have Taken 50 Million From Cybercurrency Project. The New York Times. 17 June 2016.
