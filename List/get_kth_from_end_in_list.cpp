//
// Created by FindNS on 2022/3/12.
//

#include "list_common.h"

// https://leetcode-cn.com/problems/lian-biao-zhong-dao-shu-di-kge-jie-dian-lcof/solution/lian-biao-zhong-dao-shu-di-kge-jie-dian-1pz9l/
ListNode* getKthFromEnd(ListNode *head, int k)
{
    int n = 0;
    ListNode *node = nullptr;
    for (node = head; node != nullptr; node = node->next) {
        n++;
    }
    for (node = head; n > k; --n) {
        node = node->next;
    }
    return node;
}

ListNode* getKthFromEndDualPointer(ListNode *head, int k)
{
    ListNode *slow = head;
    ListNode *fast = head;
    while (fast && k > 0) {
        fast = fast->next;
        k--;
    }
    while (fast) {
        fast = fast->next;
        slow = slow->next;
    }
    return slow;
}

void testcase1()
{
    ListNode *l1               = new ListNode(1);
    l1->next                   = new ListNode(2);
    l1->next->next             = new ListNode(3);
    l1->next->next->next       = new ListNode(4);
    l1->next->next->next->next = new ListNode(5);
    printf("yyy\n");
//    ListNode *ret = getKthFromEnd(l1, 2);
    ListNode *ret = getKthFromEndDualPointer(l1, 2);
    printf("ret = %d\n", ret->val);
}

//void testcase2()
//{
//    ListNode *l1         = new ListNode(3);
//    l1->next             = new ListNode(2);
//    l1->next->next       = new ListNode(0);
//    l1->next->next->next = new ListNode(-4);
//    printf("yyy\n");
//    bool ret = hasCycle(l1);
//    printf("ret = %d\n", ret);
//}

int main()
{
    printf("xxx\n");
    testcase1();
//    testcase2();
    return 0;
}