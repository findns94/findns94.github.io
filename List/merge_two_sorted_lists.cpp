//
// Created by FindNS on 2022/3/2.
//

// Input: 1->2->4, 1->3->4
// Output: 1->1->2->3->4->4

// 2种解法:递归和非递归

#include "list_common.h"

// 递归
ListNode *mergeTwoListsRecursive(ListNode *l1, ListNode *l2)
{
    if (!l2) {
        return l1;
    }
    if (!l1) {
        return l2;
    }
    if (l1->val > l2->val) {
        l2->next = mergeTwoListsRecursive(l1, l2->next);
        return l2;
    }
    l1->next = mergeTwoListsRecursive(l1->next, l2);
    return l1;
}

// 非递归
// 思路:使用dummy节点,消耗临时额外空间
ListNode *mergeTwoListsNonRecursive(ListNode *l1, ListNode *l2)
{
    ListNode *dummy = new ListNode(0);
    ListNode *node  = dummy;
    while (l1 && l2) {
        if (l1->val <= l2->val) {
            node->next = l1;
            l1 = l1->next;
        } else {
            node->next = l2;
            l2 = l2->next;
        }
        node = node->next;
    }
    if (l1) {
        node->next = l1;
    } else {
        node->next = l2;
    }
    return dummy->next;
}

void testcase()
{
    ListNode *l1   = new ListNode(1);
    l1->next       = new ListNode(2);
    l1->next->next = new ListNode(4);
    ListNode *l2   = new ListNode(1);
    l2->next       = new ListNode(3);
    l2->next->next = new ListNode(4);
    printf("yyy\n");
    PrintList(l1);
    ListNode *head;
//    head = mergeTwoListsRecursive(l1, l2);
    head = mergeTwoListsNonRecursive(l1, l2);
    printf("zzz\n");
    PrintList(head);
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}

