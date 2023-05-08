//
// Created by FindNS on 2022/3/1.
//

#ifndef LEETCODE_LIST_COMMON_H
#define LEETCODE_LIST_COMMON_H

#include <stdio.h>
#include <algorithm>

struct ListNode {
    int val;
    ListNode *next;
    ListNode(int x) : val(x), next(nullptr) {}
};

void PrintList(ListNode *head)
{
    while (head) {
        printf("%d\n", head->val);
        head = head->next;
    }
}

#endif //LEETCODE_LIST_COMMON_H
