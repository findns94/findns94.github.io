//
// Created by FindNS on 2022/3/13.
//

#ifndef LEETCODE_SORT_COMMON_H
#define LEETCODE_SORT_COMMON_H

#include <stdio.h>
#include <vector>
#include <queue>
#include <stack>
#include <set>
#include <map>
#include <unordered_set>
#include <unordered_map>
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

using namespace std;

#endif //LEETCODE_SORT_COMMON_H
