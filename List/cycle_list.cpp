//
// Created by FindNS on 2022/3/12.
//

#include "list_common.h"

// https://leetcode-cn.com/problems/linked-list-cycle/solution/huan-xing-lian-biao-by-leetcode-solution/
bool hasCycle(ListNode *head)
{
    if (!head) {
        return false;
    }
    ListNode *slow = head;
    ListNode *fast = head;
    do {
        if (!fast || !fast->next) {
            return false;
        }
        slow = slow->next;
        fast = fast->next->next;
    } while (slow != fast);
    return true;
}

// 如果存在,查找环路节点
//    fast = head;
//    while (fast != slow) {
//        slow = slow->next;
//        fast = fast->next;
//    }
//    return fast;

void testcase1()
{
    ListNode *l1         = new ListNode(3);
    l1->next             = new ListNode(2);
    l1->next->next       = new ListNode(0);
    l1->next->next->next = new ListNode(-4);
    l1->next->next->next->next = l1->next;
    printf("yyy\n");
    bool ret = hasCycle(l1);
    printf("ret = %d\n", ret);
}

void testcase2()
{
    ListNode *l1         = new ListNode(3);
    l1->next             = new ListNode(2);
    l1->next->next       = new ListNode(0);
    l1->next->next->next = new ListNode(-4);
//    l1->next->next->next->next = l1->next;
    printf("yyy\n");
    bool ret = hasCycle(l1);
    printf("ret = %d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase1();
    testcase2();
    return 0;
}
