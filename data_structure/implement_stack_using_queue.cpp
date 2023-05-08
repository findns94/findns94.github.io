//
// Created by FindNS on 2022/3/13.
//

#include "data_common.h"

// 尝试使用队列（queue）来实现栈（stack）
// 思路:2个队列,https://leetcode-cn.com/problems/implement-stack-using-queues/solution/yong-dui-lie-shi-xian-zhan-by-leetcode-solution/

class MyStack1 {
    queue<int> q1;
    queue<int> q2;

public:
    MyStack1() {

    }

    void push(int x) {
        q2.push(x);
        while (!q1.empty()) {
            q2.push(q1.front());
            q1.pop();
        }
        swap(q1, q2);
    }

    int pop() {
        int ret = q1.front();
        q1.pop();
        return ret;
    }

    int top() {
        return q1.front();
    }

    bool empty() {
        return q1.empty();
    }
};

// 思路:1个队列
class MyStack2 {
    queue<int> q;

public:
    MyStack2() {

    }

    // 入队的时候把前n个数取出,再入队,从而模拟stack后到先出的性质
    void push(int x) {
        int n = q.size();
        q.push(x);
        for (int i = 0; i < n; ++i) {
            q.push(q.front());
            q.pop();
        }
    }

    int pop() {
        int ret = q.front();
        q.pop();
        return ret;
    }

    int top() {
        return q.front();
    }

    bool empty() {
        return q.empty();
    }
};

void testcase()
{
//    MyStack1 *q = new MyStack1();
    MyStack2 *q = new MyStack2();
    q->push(1);
    q->push(2);
    printf("%d\n", q->top());
    q->pop();
    printf("%d\n", q->empty());
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}
