//
// Created by FindNS on 2022/3/1.
//

// Input:  1->2->3->4->5->nullptr
// Output: 5->4->3->2->1->nullptr

// 2种解法:递归和非递归

#include "list_common.h"

// 递归
ListNode *reverseListRecursive(ListNode *head, ListNode *prev=nullptr)
{
    if (!head) {
        return prev;
    }
    ListNode *next = head->next;
    head->next = prev;
    return reverseListRecursive(next,head);
}

// 非递归
ListNode *reverseListNonRecursive(ListNode *head)
{
    ListNode *prev = nullptr;
    ListNode *next;
    while (head) {
        next = head->next;
        head->next = prev;
        prev = head;
        head = next;
    }
    return prev;
}

void testcase()
{
    ListNode *head               = new ListNode(1);
    head->next                   = new ListNode(2);
    head->next->next             = new ListNode(3);
    head->next->next->next       = new ListNode(4);
    head->next->next->next->next = new ListNode(5);
    printf("yyy\n");
    PrintList(head);
    head = reverseListRecursive(head, nullptr);
//    head = reverseListNonRecursive(head);
    PrintList(head);
    printf("zzz\n");
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}
