//
// Created by FindNS on 2022/3/13.
//

#include "data_common.h"

// 尝试使用栈（stack）来实现队列（queue）
// 思路:我们可以用两个栈来实现一个队列：因为我们需要得到先入先出的结果，所以必定要通过一
// 个额外栈翻转一次数组。这个翻转过程既可以在插入时完成，也可以在取值时完成

class MyQueue {
    stack<int> s1;
    stack<int> s2;

public:
    MyQueue() {

    }

    void in2out() {
        if (s2.empty()) {
            while (!s1.empty()) {
                s2.push(s1.top());
                s1.pop();
            }
        }
    }

    // s1为输入临时保存的栈,只承担push职责
    void push(int x) {
        s1.push(x);
    }

    // s2为输出保存的栈,内容为s1弹出,push进的s2,因此s2的弹出顺序和queue一致
    // 若s2为空,则从s1再弹出并push进s2
    int pop() {
        in2out();
        int num = s2.top();
        s2.pop();
        return num;
    }

    // 获取队列front元素,由于s2可能为空,也需要一次s1弹出,push进s2的流程
    int peek() {
        in2out();
        int num = s2.top();
        return num;
    }

    bool empty() {
        return s1.empty() && s2.empty();
    }
};

void testcase()
{
    MyQueue *q = new MyQueue();
    q->push(1);
    q->push(2);
    printf("%d\n", q->peek());
    q->pop();
    printf("%d\n", q->empty());
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}
