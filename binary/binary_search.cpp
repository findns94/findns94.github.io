//
// Created by FindNS on 2021/6/28.
//

#include "binary_common.h"

int binary_search_lower_bound(vector<int> nums, int l, int r, int val)
{
    while (l < r) {
        int m = l + (r - l) / 2;
        if (nums[m] < val) {
            l = m + 1;
        } else {
            r = m;
        }
    }
    return l;
}

int binary_search_upper_bound(vector<int> nums, int l, int r, int val)
{
    while (l < r) {
        int m = l + (r - l) / 2;
        if (nums[m] <= val) {
            l = m + 1;
        } else {
            r = m;
        }
    }
    return l;
}

// https://leetcode-cn.com/problems/search-in-rotated-sorted-array/solution/duo-si-lu-wan-quan-gong-lue-bi-xu-miao-dong-by-swe/
int binary_search_1(vector<int> nums, int target)
{
    int l = 0;
    int r = nums.size() - 1;
    while (l < r) {
        int mid = l + (r - l) / 2;
        if (nums[mid] == target) {
            return mid;
        }
        if (nums[mid] < target) {
            l = mid + 1;
        } else {
            r = mid - 1;
        }
    }
    return -1;
}

int main() {
    vector<int> nums = {1,2,3,4,5};
    cout << binary_search_lower_bound(nums, 0, 4, 4) << endl;
    cout << binary_search_upper_bound(nums, 0, 4, 4) << endl;
    cout << binary_search_1(nums, 4) << endl;
    return 0;
}

