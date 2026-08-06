---
title: 智能合约的形式化验证
date: 2019-04-22 22:41:57
tags: [Blockchain, Security, Formal Verification]
categories: [Course]
math: true
---

智能合约是一种代码合约和算法合约，将成为未来数字社会的基础技术，它利用协议和用户接口完成合约过程的所有步骤。本文总结了智能合约的主要技术特点以及现存的可信度与安全性问题，提出将形式化方法应用于智能合约的建模、模型检测与形式化验证过程，以支持大规模智能合约的生成。

<!-- more -->

以太坊（Ethereum）是一个开源的、具备智能合约功能的公共区块链平台 [1][2]。通过其专用加密货币以太币（Ether），以太坊提供了一台去中心化的虚拟机——即"以太坊虚拟机"（Ethereum Virtual Machine）——来处理点对点合约。

以太坊最重要的技术贡献是智能合约。智能合约是存储在区块链上的程序，能够协助并完成合约的谈判与执行。以太坊的智能合约可以用数种图灵完备的编程语言编写 [3]。以太坊平台是一台由众多用户共同运行维护的公用电脑，并用以太币来分配和支付这台电脑的使用权 [4]。智能合约使得众多组织的数据库能够以低成本进行交互，并允许用户编写精密的合约。其功能之一是创建去中心化自治组织（DAO），即完全由以太坊合约构成的虚拟公司 [5]。

由于合约内容公开，合约可以证明其宣称的功能是真实的——例如虚拟赌场可以证明自己是公平的 [6]。另一方面，合约的公开性也意味着：如果合约中存在漏洞，任何人都能立即看到，而修复代码可能需要一定的时间 [7]。The DAO 就是一起无法被实时阻止的安全事件 [8]。

The DAO：DAO 是 Decentralized Autonomous Organization（去中心化自治组织）的缩写。The DAO 曾是当时以太坊区块链平台上规模最大的众筹项目。其目的是让持有 The DAO 代币的参与者通过投票共同决定投资哪些项目，整个社区完全自治，并通过代码编写的智能合约来实现。The DAO 共筹集了 1170 万以太币（当时价值约 2.45 亿美元），创造了众筹历史上的最高纪录。

然而在 2016 年 6 月 17 日，运行在以太坊公链上的 The DAO 智能合约遭遇了攻击。攻击者通过对一个函数的递归调用，将合约筹集的资金不断转入自己的子合约中，涉及金额折合超过 300 万亿新台币。智能合约的许多细节目前仍在研究之中，包括如何验证合约的功能、如何对已发布的合约进行大规模分析，以及如何发现并识别合约中的漏洞。

由于 The DAO 是一个运行在以太坊上的开源项目，其代码已在以太坊平台上公开。我们聚焦于 The DAO 智能合约交易场景中的安全漏洞，使用 NuSMV 建模语言对该过程进行了抽象建模，随后通过 NuSMV 对模型进行验证，成功找到了该智能合约在交易场景下的安全漏洞。在此基础上，我们针对该漏洞在模型层面对智能合约进行了修复，然后再次使用 NuSMV 对修复后的模型进行验证，最终确认该漏洞已被准确修复。

# 问题描述

## The DAO 交易流程解析

![image](/posts/dao-validation/images/dao_process.PNG)

上图展示了攻击者攻击 The DAO 的主要流程：

1. 首先，攻击者在 The DAO 中创建一个新的合约。
2. 然后利用该合约向 splitDAO 发起 split 请求：
根据白皮书的设计，splitDAO 的本意是保护投票中处于弱势地位的少数派，防止他们被多数派通过合法的投票机制加以剥削。通过分裂出一个小规模的 DAO，赋予他们"用脚投票"的机制，同时确保他们仍然能够获取分裂前外部资金所带来的潜在收益。
3. 一旦 splitDAO 批准了 split 请求，它将创建 childDAO（如果尚未存在），并将分裂者拥有的 Ether 转入 childDAO 中（这是当时唯一可行的提取 Ether 的途径）。
4. 最后，child token 被返回给原合约，从而让发起 split 请求的人获得对新分裂出的 childDAO 的访问权限。

截至目前，以上四个步骤看起来并无任何异常。然而，真正的危机在第三步 Ether 转入 childDAO 的那一刻便已悄然发生。下面我们来看第三个步骤中 splitDAO 具体是如何转移 Ether 的。

![image](/posts/dao-validation/images/dao_process_2.PNG)

3.1 splitDAO 首先检查提议者的 ID 是否有效，以及提议者是否已投赞成票（通过前两步的正常流程，攻击者的这些验证信息很容易通过）。检查通过后，splitDAO 发起 withdraw 请求，调用 withdraw 函数。

3.2 随后，withdraw 函数通过一系列计算得出需要转移的 Ether 数量，然后调用 payout 函数。

3.3 根据 The DAO 的设计，payout 函数首先调用用户原合约中自定义的 callback 函数（类似于通知用户 split 请求已完成，让用户可以执行一些自定义操作），然后执行步骤 3.4：**调用真正的 Payout 函数（该函数执行实际的转账操作，是一个不提供外部接口的内部函数，也是原子操作）**。

在正常流程中，执行应按 3.1、3.2、3.3、3.4 的顺序依次完成，此后转账成功，一切正常。

然而，问题恰恰出现在用户自定义的回调函数上：攻击者在回调函数中再次调用 splitDAO，发起 withdraw 操作。这样一来，正常的流程就变成了 3.1、3.2、3.3、3.5（3.4 被压入栈中）、3.1、3.2、3.3、3.5……如此无限递归下去，直到 callback 停止 3.5 过程，不再调用 splitDAO。此时，被压入栈中的多个 3.4 Payout 转账操作将被重复执行，攻击者的账户凭空获得大量 Ether。

# The DAO 交易流程状态机

为了使用 NuSMV 对上述流程进行建模验证，我们首先需要对该交易流程进行抽象建模。考虑到状态机模型与 NuSMV 模型的匹配度较高，我们首先将该流程抽象为三个不同模块的状态机：user 模块、contract 模块以及 splitDAO 模块。

## User 模块主要状态机

![image](/posts/dao-validation/images/user_state.PNG)

对于 User 模块，主要包含 4 个重要状态：初始化状态，此时用户 account 为 0，创建的合约和 splitDAO 均处于初始状态。随后，处于初始状态的用户发起 split 请求后，splitRequest 被置为 true，合约状态变为 split_contract，splitDAO 接收到请求后分裂为 childDAO 状态，同时合约状态更新为 child_contract。最后，当 splitDAO 完成所有 Payout 操作后，返回 childDAO 的控制令牌 child_token（将其设为 true），同时将用户的 account 变更为 12 Ether，new_contract 和 splitDAO 的状态均更新为 end。

## Contract 模块主要状态机

![image](/posts/dao-validation/images/contract.PNG)

对于 contract 模块，同样包含 4 个最重要的状态：初始状态，Ether 设为 10，合约状态为 new_contract。当合约发起 split_proposal 请求时，splitRequest 状态被置为 true，合约状态变为 split_contract。当 splitDAO 创建完新的 childDAO 后，child_token 被置为 true，同时合约状态变为 child_contract。最后，合约发起 withdraw 请求，将 Ether 加上收益更新为 12，随后合约状态置为 end。

## splitDAO 模块主要状态机

由于 NuSMV 不支持函数调用，为了模拟函数调用栈的行为，我们额外创建了一个简易的 stack 栈模块，其主要状态机如下图所示：

### Stack 模块状态机图

![image](/posts/dao-validation/images/stack.PNG)

当接收到的操作是 push 操作时，栈将当前状态存入 function_stack 数组，并将对应的指针 counts 加 1；当操作是 pop 时，返回 function_stack 数组中指针当前指向的状态，并将指针 counts 减 1；当操作是 relax 时，状态保持不变。

### splitDAO 核心状态图

![image](/posts/dao-validation/images/splitDao_core.png)

splitDAO 的初始状态投票数 votingNum 为 0。当有合约发起 split 请求后，投票数相应加 1。当投票数达到某一阈值（这里我们假设为 20）后，splitDAO 开始执行 split 操作。splitDAO 发起分裂请求后，时间 now 持续累加 1。根据 The DAO 的设计，需要等待 7 天后，split 操作才会完全生效。之后将创建一个新的 childDAO，并将访问控制令牌 child_token 设为 true，返回给所有 split 请求者。

此后，splitDAO 需要将原合约的 Ether 转入新的 childDAO，并计算整个合约的 reward 值，连同 Ether 一并转入 childDAO。因此，splitDAO 将发起 withdraw 请求，并将状态设为 withdraw_reward_for。在此，它首先检查 paidout 是否小于 reward（这一步至关重要，后续将详细说明）。如果条件满足，则调用 payout 方法。

在 payout 方法中，它首先调用用户在原合约中自定义的 userFunction（即回调函数），然后紧接着调用真实的转账函数 Payout。如果回调函数中递归调用了 splitDAO，那么每次 payout 调用 Payout 时都会将其暂时压入栈中，直到递归结束后，栈中的实际转账任务才依次执行。这里我们通过自定义的简单栈来模拟这一过程：每次调用 callback 之前，将 operation 置为 push，将 PayOut 操作压入栈中；当 callback 不再调用 splitDAO 时，将 operation 置为 pop，此时栈中的 PayOut 操作将被依次弹出执行。

最后，当所有 PayOut 操作执行完毕后，account 的值已被累加多次，splitDAO 将 paidOut 的值设为 paidOut + reward。

此外值得注意的是，The DAO 引入了 gas 的概念：

合约的执行会在所有节点中被重复进行，这使得合约执行的成本变得昂贵，因此也促使人们将尽可能多的计算放到链下进行。每个被执行的命令都有特定的消耗，以 gas 为单位计量。每个合约可使用的命令都有对应的 gas 值。

每笔交易都被要求包含一个 gas limit。如果交易所需要的 gas 总量（包括原始消息和所有触发的附加消息）小于或等于设定的 gas limit，该交易将被处理。如果 gas 总消耗超过 gas limit，所有操作将被回滚，交易本身仍视为有效，交易费仍由矿工收取。区块链会显示该交易已完成尝试，但由于 gas 不足，所有合约命令均被回滚。交易中未使用的多余 gas 将以 Ether 的形式退还给交易发起者。

因此，为了避免 gas 耗尽的情况，攻击者在自定义的 callback 函数中，会在对 gas 施加一定数量限制的前提下递归调用 splitDAO 函数（这里我们假设 gas = 10）。

# 漏洞修复

通过对 splitDAO 关键状态机的流程分析，我们可以很容易地发现问题所在：

首先，在 withdraw 函数中，在调用 payout 之前，系统会比对 reward 的值和 paidOut 的值，以避免重复调用 payout。并且当真正的 PayOut 函数执行完毕后，reward 的值也确实会被加到 paidOut 上。

然而攻击者的巧妙之处在于利用了调用栈的机制，递归地调用 splitDAO 的 withdraw 函数。由于前一次本应执行的 PayOut 函数仍在栈中尚未执行，paidOut 的值尚未发生变化，因此能够顺利绕过 withdraw 函数的检查机制，最终导致多次递归转账。

一旦理解了这个问题，修复它就变得非常简单：
只需将 paidout 值的更新放在 PayOut 函数调用之前，而非之后。
仅需这一微小的改动，此后即便 callback 函数递归调用 splitDAO 的 withdraw 函数，函数的检查机制也会发现 paidOut 的值已发生变化且不再小于 reward，说明 payout 已被调用过，从而阻止进一步的递归调用。该漏洞由此得以解决。

# NuSMV 建模过程

## 属性概览

| main 模块 | 类型 | 含义 |
|:---:|:---:|:---:|
| gas | integer; | 燃料，为 0 时交易停止 |
| user | user | 用户，拥有合约，传入参数为燃料 |

| User 模块 | 类型 | 含义 |
|:---:|:---:|:---:|
| account | integer | 用户账户的余额 |
| splitRequest | boolean | 分裂合约的请求 |
| child_token | boolean | 标志可以取款的许可 |
| new_contract | contract | 合约 |
| split_dao | splitDAO | 分裂出子 DAO 的过程 |

| contract 模块 | 类型 | 含义 |
|:---:|:---:|:---:|
| ETH | integer | 以太币，以太坊平台上的货币 |
| states | enumeration | 合约的状态，可取的状态有 new_contract、split_contract、child_contract 和 end |
| directions | enumeration | 合约转移的方向，可取的值有发起 split 请求、取款和保持当前状态 |

| stack 模块 | 类型 | 含义 |
|:---:|:---:|:---:|
| counts | integer | 记录当前栈的深度 |
| function_stack | array | 使用数组构造的栈，取值有 callback_function 和 PayOut，分别代表回调函数和付款 |

| splitDao 模块 | 类型 | 含义 |
|:---:|:---:|:---:|
| votingNum | integer | 投票数目 |
| votingFloor | integer | 投票通过的最低阈值 |
| votingDeadline | integer | 投票截止日期 |
| now | integer | 当前日期 |
| operation | enumeration | 栈的操作，取值为 stackpush、stackpop 和 relax，分别表示压入元素、弹出元素和无操作 |
| pushStates | enumeration | 压入栈的元素，取值有 callback_function 和 PayOut，分别代表回调函数和付款 |
| popStates | enumeration | 弹出栈的元素，取值有 callback_function 和 PayOut，分别代表回调函数和付款 |
| states | enumeration | 状态 |
| paidout | integer | 累计收益 |
| reward | integer | 通过分裂合约获得的收益 |
| functionStack | stack | 栈结构 |
| accumulatedInput | integer | 计算收益 reward 的变量 |
| totalSupply | integer | 计算收益 reward 的变量 |
| balanceOf | integer | 计算收益 reward 的变量 |

## 流程说明

根据第二节中介绍的三个模块的状态机模型，我们将其翻译为 NuSMV 模型，具体实现细节详见代码。随后，我们设置 NuSMV 断言：**SPEC AG !(user.new_contract.ETH > 12)**；
用于判断攻击者是否成功利用漏洞获取了额外的 Ether。
按照正常流程，用户执行 split 操作应获得本金 10 Ether 加上原合约收益 2 Ether，共计 12 Ether。因此，若流程中用户的 Ether 超过 12，则说明该智能合约存在漏洞。
随后通过 NuSMV 验证指令对该模型进行验证。

## 验证结果

通过上述流程，NuSMV 的模型验证结果如下所示：

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

结果表明该模型中确实存在漏洞，会导致用户获得额外的 Ether。

## 修复过程与再次验证

根据第二节漏洞修复小节中分析的修复方案，我们将 paidout 值的更新逻辑由：

```bash
next (paidout):=
            case
                states = PayOut & paidout<90 : paidout + reward;
                TRUE:paidout;
            esac;
```

修改为：

```bash
next (paidout):=
            case
                states = payOut & paidout<90 : paidout + reward;
                TRUE:paidout;
            esac;
```

为了验证修改后的模型不仅能够修复之前的漏洞，还能使智能合约按照原有设计正常运行——即即便攻击者编写了异常攻击代码，正常业务逻辑仍会给予其正常数量的 Ether。

因此我们新增了一条 NuSMV 断言：**SPEC AG !(user.new_contract.ETH = 12)**

用于判断整体流程结束后，用户合约中的余额是否为 12 Ether。

修改后的模型验证结果如下所示：

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

结果说明：

1. 原 The DAO 交易流程中存在的漏洞已被成功修复。
2. 修复后的模型能够按照预期的正常流程运行。

# 总结

本次实验中，我们通过阅读以太坊上 The DAO 的开源代码，理解了包含漏洞的交易流程，然后将该流程转换为与 NuSMV 高度相似的状态机模型。最后通过 NuSMV 的模型检测功能，成功复现了 The DAO 智能合约中的安全漏洞问题。

随后，我们针对 The DAO 中的漏洞在模型层面进行了修复，并使用 NuSMV 对修复后的模型进行了再次检验。最终验证结果表明：我们成功修复了原有的安全漏洞，且没有破坏原有的正常逻辑流程。

通过 The DAO 这一验证实例可以看出，智能合约中确实存在可信度与安全性方面的问题，而形式化方法能够很好地应用于智能合约的全生命周期验证。一个优秀的模型检测工具有助于检查和验证智能合约的各项属性，从而保障智能合约的安全性。

# 参考文献

[1]	Gray, Jeff. Bitcoin believers: Why digital currency backers are keeping the faith. The Globe and Mail (Phillip Crawley). 7 April 2014 [17 February 2016].

[2]	Vigna, Paul. BitBeat: Microsoft to Offer Ethereum-Based Services on Azure. The Wall Street Journal (Blog). News Corp. 28 October 2015 [17 February 2016].

[3]	Jon, Evans. Vapor No More: Ethereum Has Launched. techcrunch.com. [25 February 2016].

[4]	Nathaniel Popper for the New York Times. March 27, 2016 Ethereum, a Virtual Currency, Enables Transactions That Rival Bitcoin's.

[5]	The great chain of being sure about things. The Economist. 31 October 2015 [4 May 2016].

[6]	Piasecki, Piotr J. Gaming Self-Contained Provably Fair Smart Contract Casinos. Ledger. 2016, 1: 99–110. doi:10.5195/ledger.2016.29.

[7]	Peck, M. Ethereum's 150-Million Blockchain-Powered Fund Opens Just as Researchers Call For a Halt. IEEE Spectrum. Institute of Electrical and Electronics Engineers. 28 May 2016.

[8]	Popper, Nathaniel. Hacker May Have Taken 50 Million From Cybercurrency Project. The New York Times. 17 June 2016.
