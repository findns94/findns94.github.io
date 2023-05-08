//
// Created by FindNS on 2022/3/2.
//

// 链表交换邻近节点
// Input: 1->2->3->4
// Output: 2->1->4->3

// 2种解法:递归和非递归

#include "list_common.h"

ListNode *swapPairs(ListNode *head)
{
    ListNode *p = head;
    ListNode *s;
    if (p && p->next) {
        s = p->next;
        p->next = s->next;
        s->next = p;
        head = s;
        while (p->next && p->next->next) {
            s = p->next->next;
            p->next->next = s->next;
            s->next = p->next;
            p->next = s;
            p = s->next;
        }
    }
    return head;
}

void testcase()
{
    ListNode *l1         = new ListNode(1);
    l1->next             = new ListNode(2);
    l1->next->next       = new ListNode(3);
    l1->next->next->next = new ListNode(4);
    printf("yyy\n");
    PrintList(l1);
    ListNode *head;
    head = swapPairs(l1);
    printf("zzz\n");
    PrintList(head);
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}