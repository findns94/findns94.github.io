//
// Created by FindNS on 2022/3/20.
//

#include "sort_common.h"

// https://leetcode-cn.com/problems/shu-zu-zhong-de-ni-xu-dui-lcof/
// https://www.acwing.com/solution/content/38817/

vector<int> temp;

// 归并排序
// 时间复杂度
int merge(vector<int> &nums, int low, int mid, int high, int &res)
{
    // nums[low...mid] 和 nums[mid+1...high]分别有序,归并为[low...high]
    // 使用临时数组O(n)
    int k = low;
    int i = low;
    int j = mid + 1;
    // 复制nums[low,high]到临时数组
    for (int m = low; m <= high; ++m) {
        temp[m] = nums[m];
    }
    // 归并temp[low...mid] 和 temp[mid+1...high] 到 nums[low, high]
    while (i <= mid && j <= high) {
        if (temp[i] <= temp[j]) {
            nums[k++] = temp[i++];
        } else {
            nums[k++] = temp[j++];
            res += mid + 1 - i; // 记录逆序对
            // mid−i+1 表示的是区间 [i,mid] 的长度
        }
    }
    // 处理temp[low...mid] 或 temp[mid+1...high] 未归并的部分
    while (i <= mid) {
        nums[k++] = temp[i++];
    }
    while (j <= high) {
        nums[k++] = temp[j++];
    }
    return res;
}

int mergeSort(vector<int> &nums, int l, int r, int &res)
{
    if (l < r) {
        int mid = (l + r) / 2;
        res = mergeSort(nums, l, mid, res) + mergeSort(nums, mid + 1, r, res);
        merge(nums, l, mid, r, res);
        return res;
    } else {
        return 0;
    }
}

int reversePairs(vector<int>& nums) {
    int n = nums.size();
    int res = 0;
    // 归并排序申请额外空间
    temp.resize(n, 0);
    return mergeSort(nums, 0, n - 1, res);
}

void testcase1()
{
    vector<int> nums = {7,5,6,4};
    int ret = reversePairs(nums);
    printf("%d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase1();
    return 0;
}

