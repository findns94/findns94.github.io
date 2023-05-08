//
// Created by FindNS on 2022/3/9.
//

// 以 O(1) 的空间复杂度，判断链表是否回文。
// Input: 1->2->3->2->1
// Output: true

// 解法:快慢指针找到中点，后半部分链表反转，

#include "list_common.h"

// 非递归
ListNode *reverseList(ListNode *head)
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

bool isPalindrome(ListNode *head)
{
    if (!head || !head->next) {
        return true;
    }
    ListNode *slow = head;
    ListNode *fast = head;
    while (fast->next && fast->next->next) {
        slow = slow->next;
        fast = fast->next->next;
    }
    slow->next = reverseList(slow->next);
    slow = slow->next;
    while (slow) {
        if (head->val != slow->val) {
            return false;
        }
        head = head->next;
        slow = slow->next;
    }
    return true;
}

void testcase()
{
    ListNode *head               = new ListNode(1);
    head->next                   = new ListNode(2);
    head->next->next             = new ListNode(3);
    head->next->next->next       = new ListNode(2);
    head->next->next->next->next = new ListNode(1);
    head->next->next->next->next->next = new ListNode(3);
    printf("yyy\n");
    PrintList(head);
    bool ret = isPalindrome(head);
    printf("is Palindrome ret = %d\n", ret);
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
