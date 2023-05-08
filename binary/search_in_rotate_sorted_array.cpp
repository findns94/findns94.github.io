//
// Created by FindNS on 2022/3/30.
//

#include "binary_common.h"

// 旋转有序数组查找
// https://leetcode-cn.com/problems/search-in-rotated-sorted-array-ii/?utm_source=LCUS&utm_medium=ip_redirect&utm_campaign=transfer2china

bool search(vector<int> &nums, int target) {
    int l = 0;
    int r = nums.size() - 1;
    while (l <= r) {
        int mid = l + (r - l) / 2;
        if (nums[mid] == target) {
            return true;
        }
        if (nums[l] == nums[mid]) {
            ++l;
        } else if (nums[mid] <= nums[r]) {
            if (nums[mid] < target && target <= nums[r]) {
                l = mid + 1;
            } else {
                r = mid - 1;
            }
        } else {
            if (nums[l] <= target && target < nums[mid]) {
                r = mid - 1;
            } else {
                l = mid + 1;
            }
        }
    }
    return false;
}

void testcase1()
{
    vector<int> nums = {2,5,6,0,0,1,2};
    int target = 0;
    int ret = search(nums, target);
    printf("ret = %d\n", ret);
}

void testcase2()
{
    vector<int> nums = {2,5,6,0,0,1,2};
    int target = 3;
    int ret = search(nums, target);
    printf("ret = %d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase1();
    printf("yyy\n");
    testcase2();
    return 0;
}
