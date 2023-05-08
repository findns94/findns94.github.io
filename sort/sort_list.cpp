//
// Created by FindNS on 2022/3/24.
//

#include "sort_common.h"

// https://leetcode-cn.com/problems/shu-zu-zhong-de-ni-xu-dui-lcof/
// https://www.acwing.com/solution/content/38817/

vector<int> temp;

/* 解法1:归并排序 */
void merge(vector<int> &nums, int low, int high, int mid)
{
    int i = low;
    int j = mid + 1;
    int k = low;
    for (int t = low; t <= high; ++t) {
        temp[t] = nums[t];
    }
    while (i <= mid && j <= high) {
        if (temp[i] < temp[j]) {
            nums[k++] = temp[i++];
        } else {
            nums[k++] = temp[j++];
        }
    }
    while (i <= mid) {
        nums[k++] = temp[i++];
    }
    while (j <= high) {
        nums[k++] = temp[j++];
    }
}

void mergeSort(vector<int> &nums, int l, int r)
{
    if (l < r) {
        int i = (l + r) / 2;
        mergeSort(nums, l, i);
        mergeSort(nums, i + 1, r);
        merge(nums, l, r, i);
    }
}

// 归并2个有序链表
ListNode *mergeList(ListNode *l1, ListNode *l2) {
    ListNode *dummy = new ListNode(-1);
    ListNode *node = dummy;
    while (l1 && l2) {
        if (l1->val < l2->val) {
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
    }
    if (l2) {
        node->next = l2;
    }
    return dummy->next;
}

// 快慢指针查找中间节点
ListNode *findMidNode(ListNode *head)
{
    if (head == nullptr || head->next == nullptr) {
        return nullptr;
    }
    ListNode *slow = head;
    ListNode *fast = head;
    while (!fast->next && !fast->next->next) {
        slow = slow->next;
        fast = fast->next->next;
    }
    return slow;
}

ListNode *mergeSortList(ListNode *head)
{
    // 找到链表中间节点
    ListNode *mid = findMidNode(head);
    if (mid) {
        ListNode *right = mid->next;
        mid->next = nullptr; // 拆分左链表和右链表
        ListNode *left = mergeSortList(head);
        right = mergeSortList(right);
        // 合并
        head = mergeList(left, right);
    }
    return head;
}

ListNode *sortList(ListNode *head)
{
    return mergeSortList(head);
}

//ListNode *mergeSortList(ListNode *head)
//{
//    if (!head || !head->next) {
//        return head;
//    }
//    ListNode *slow = head;
//    ListNode *fast = head;
//    ListNode *pre  = head;
//    while (fast && fast->next) {
//        pre  = slow;
//        slow = slow->next;
//        fast = fast->next->next;
//    }
//    pre->next = nullptr;
//    return mergeList(mergeSortList(head), mergeSortList(slow));
//}

/* 解法2:快速排序 */

void testcase1()
{
    ListNode *head               = new ListNode(1);
    head->next                   = new ListNode(5);
    head->next->next             = new ListNode(3);
    head->next->next->next       = new ListNode(2);
    head->next->next->next->next = new ListNode(4);
    head->next->next->next->next->next = new ListNode(3);
    printf("yyy\n");
    PrintList(head);
    printf("zzz\n");
    head = sortList(head);
    printf("ttt\n");
    PrintList(head);
}

int main()
{
    printf("xxx\n");
    testcase1();
    return 0;
}
