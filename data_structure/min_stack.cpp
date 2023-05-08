//
// Created by FindNS on 2022/4/4.
//

#include "data_common.h"

// 2个栈
// 时间复杂度O(1)
// 空间复杂度O(n) <-> 2n
// 将第一个元素入栈。
// 新加入的元素如果大于栈顶元素，那么新加入的元素就不处理。
// 新加入的元素如果小于等于栈顶元素，那么就将新元素入栈。
// 出栈元素不等于栈顶元素，不操作。
// 出栈元素等于栈顶元素，那么就将栈顶元素出栈。
// https://leetcode-cn.com/problems/min-stack/solution/xiang-xi-tong-su-de-si-lu-fen-xi-duo-jie-fa-by-38/

class MinStack {
    stack<int> s;
    stack<int> minStack;

public:
    MinStack() {

    }

    void push(int val) {
        s.push(val);
        if (!minStack.empty()) {
            int top = minStack.top();
            if (val <= top) {
                minStack.push(val);
            }
        } else {
            minStack.push(val);
        }
    }

    void pop() {
        int pop = s.top();
        s.pop();
        int top = minStack.top();
        if (top == pop) {
            minStack.pop();
        }
    }

    int top() {
        int val = s.top();
        return val;
    }

    int getMin() {
        return minStack.top();
    }
};

// 1个栈
// 时间复杂度O(1)
// 空间复杂度O(n) <-> 2n
// 压入minVal,再压入val
// 类似解法,压入node(val,min_val)
// https://leetcode-cn.com/problems/min-stack/solution/zui-yi-dong-yi-ge-zhan-tong-shi-bao-cun-dang-qian-/

class MinStack2 {
    stack<int> s;
    int minVal = INT_MAX;

public:
    MinStack2() {

    }

    void push(int val) {
        //当前值更小
        if (val <= minVal) {
            //将之前的最小值保存
            s.push(minVal);
            //更新最小值
            minVal = val;
        }
        s.push(val);
    }

    void pop() {
        if (s.empty()) {
            return;
        }
        int pop = s.top();
        s.pop();
        //如果弹出的值是最小值，那么将下一个元素更新为最小值
        if (pop == minVal) {
            minVal = s.top();
            s.pop();
        }
    }

    int top() {
        int val = s.top();
        return val;
    }

    int getMin() {
        return minVal;
    }
};

// 1个栈
// 时间复杂度O(1)
// 空间复杂度O(n) <-> n
// 保存差值
// https://leetcode-cn.com/problems/min-stack/solution/xiang-xi-tong-su-de-si-lu-fen-xi-duo-jie-fa-by-38/

// 1. 每次存入的是 原来值 - 当前最小值。
// 2. 当原来值大于等于当前最小值的时候，我们存入的肯定就是非负数，所以出栈的时候就是 栈中的值 + 当前最小值 。
// 3. 当原来值小于当前最小值的时候，我们存入的肯定就是负值，此时的值我们不入栈，用 min 保存起来，同时将差值入栈。
// 4. 当后续如果出栈元素是负数的时候，那么要出栈的元素其实就是 min。此外之前的 min 值，我们可以通过栈顶的值和当前 min 值进行还原，就是用 min 减去栈顶元素即可。

class MinStack3 {
    stack<long> s; //用int会溢出！
    // 有可能溢出,使用long
    long minVal = 0; //用来存每一步的差值d_val

public:
    MinStack3() {

    }

    void push(int val) {
        if (s.empty()) {
            minVal = val;
            s.push(val - minVal);
        } else {
            s.push(val - minVal);
            if (val < minVal) {
                minVal = val; // 更新最小值
            }
        }
    }

    void pop() {
        if (s.empty()) {
            return;
        }
        long pop = s.top();
        s.pop();
        //如果弹出的值是负值,更新minVal
        if (pop < 0) {
            minVal = minVal - pop;
        }
    }

    int top() {
        long top = s.top();
        //负数的话，出栈的值保存在 min 中
        if (top < 0) {
            return (int)minVal;
        } else {
            //出栈元素加上最小值即可
            return (int)(top + minVal);
        }
    }

    int getMin() {
        return (int)minVal;
    }
};

void testcase()
{
    MinStack *minstack = new MinStack();
    int ret;
    minstack->push(-2);
    minstack->push(0);
    minstack->push(-3);
    ret = minstack->getMin();
    printf("%d\n", ret);
    minstack->pop();
    ret = minstack->top();
    printf("%d\n", ret);
    ret = minstack->getMin();
    printf("%d\n", ret);
}

void testcase2()
{
    MinStack2 *minstack = new MinStack2();
    int ret;
    minstack->push(-2);
    minstack->push(0);
    minstack->push(-3);
    ret = minstack->getMin();
    printf("%d\n", ret);
    minstack->pop();
    ret = minstack->top();
    printf("%d\n", ret);
    ret = minstack->getMin();
    printf("%d\n", ret);
}

void testcase3()
{
    MinStack3 *minstack = new MinStack3();
    int ret;
    minstack->push(-2);
    minstack->push(0);
    minstack->push(-3);
    ret = minstack->getMin();
    printf("%d\n", ret);
    minstack->pop();
    ret = minstack->top();
    printf("%d\n", ret);
    ret = minstack->getMin();
    printf("%d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase();
    printf("yyy\n");
    testcase2();
    printf("zzz\n");
    testcase3();
    return 0;
}
