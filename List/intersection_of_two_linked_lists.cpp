//
// Created by FindNS on 2022/3/7.
//

// 给定两个链表，判断它们是否相交于一点，并求这个相交节点。
// Input:
// A:       a1 -> a2
//                |
//                v
//                c1 -> c2 -> c3
//                ^
//                |
// B: b1 -> b2 -> b3
// Output: c1

// 解法:双指针前进

#include "list_common.h"

ListNode *getIntersectionNode(ListNode *headA, ListNode *headB)
{
    ListNode *l1 = headA;
    ListNode *l2 = headB;
    while (l1 != l2) { // 若都是null,循环退出,返回null,表示找不到
        if (l1) {
            l1 = l1->next;
        } else {
            l1 = headB;
        }
        if (l2) {
            l2 = l2->next;
        } else {
            l2 = headA;
        }
    }
    return l1;
}

void testcase()
{
    ListNode *l1         = new ListNode(1);
    l1->next             = new ListNode(2);
    l1->next->next       = new ListNode(3);
    l1->next->next->next = new ListNode(4);
    l1->next->next->next->next = new ListNode(5);
    ListNode *l2         = new ListNode(-1);
    l2->next             = new ListNode(-2);
    l2->next->next       = new ListNode(-3);
    l2->next->next->next = l1->next->next;
    printf("yyy\n");
    PrintList(l1);
    printf("===\n");
    PrintList(l2);
    ListNode *head;
    head = getIntersectionNode(l1, l2);
    printf("zzz\n");
    PrintList(head);
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}