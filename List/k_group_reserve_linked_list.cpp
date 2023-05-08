//
// Created by FindNS on 2022/4/10.
//

#include "list_common.h"

// 翻转以head为头的链表
ListNode *reverse(ListNode *head)
{
    ListNode *next;
    ListNode *prev = nullptr;
    while (head) {
        next = head->next;
        head->next = prev;
        prev = head;
        head = next;
    }
    // 返回新的链表头
    return prev;
}

ListNode *reverseKGroup(ListNode *head, int k) {
    if (head == nullptr || head->next == nullptr) {
        return head;
    }
    // 添加dummy头节点,记住链表开头位置,return返回时使用
    ListNode *dummy = new ListNode(0);
    dummy->next = head;
    ListNode *prev = dummy;
    ListNode *start = head;
    ListNode *end = head;
    ListNode *next = head;
    while (next) {
        // 关键点1: i从1开始
        // 根据k找到end,注意链表是否结束
        for (int i = 1; i < k && end != nullptr; ++i) {
            end = end->next;
        }
        // 如果链表尾部没有被k整除,跳出while循环
        if (end == nullptr) {
            break;
        }
        // 翻转区进行翻转
        next = end->next;
        end->next = nullptr;
        end = start;
        start = reverse(start);
        end->next = next;
        prev->next = start;
        // 重新指定prev,start,end
        prev = end;
        start = next;
        end = start;
    }
    return dummy->next;
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
    printf("xxx\n");
//    head = reverse(head);
    head = reverseKGroup(head, 2);
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

