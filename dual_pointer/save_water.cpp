//
// Created by FindNS on 2022/4/23.
//

#include "dual_common.h"

// 1. DP
// 从左扫一遍
// 从右扫一遍
// 累加min(max_left[i],max_right[i])-height[i]
// 时间复杂度：O(n)
// 空间复杂度：O(n)
int trap(vector<int> &height) {
    if (height.size() < 2) {
        return 0;
    }
    int n = height.size();
    int ans = 0;
    vector<int> left(n, 0);
    vector<int> right(n, 0);
    left[0] = height[0];
    for (int i = 1; i < n; ++i) {
        left[i] = max(height[i], left[i - 1]);
    }
    right[n - 1] = height[n - 1];
    for (int i = n - 2; i >= 0; --i) {
        right[i] = max(height[i], right[i + 1]);
    }
    for (int i = 1; i < n; ++i) {
        ans += min(left[i], right[i]) - height[i];
    }
    return ans;
}

// 双指针空间优化O(1)
int trapDualPointer(vector<int> &height) {
    if (height.size() < 2) {
        return 0;
    }
    int n = height.size();
    int ans = 0;
    int left = 0;
    int right = n - 1;
    int left_max = 0;
    int right_max = 0;
    while (left < right) {
        if (height[left] < height[right]) {
            if (height[left] >= left_max) {
                left_max = height[left];
            } else {
                ans += (left_max - height[left]);
            }
            left++;
        } else {
            if (height[right] >= right_max) {
                right_max = height[right];
            } else {
                ans += (right_max - height[right]);
            }
            right--;
        }
    }
    return ans;
}

void testcase()
{
    vector<int> height = {0,1,0,2,1,0,1,3,2,1,2,1};
//    int ret = trap(height);
    int ret = trapDualPointer(height);
    printf("ret = %d\n", ret);
    printf("zzz\n");
}

void testcase2()
{
    vector<int> height = {4,2,0,3,2,5};
//    int ret = trap(height);
    int ret = trapDualPointer(height);
    printf("ret = %d\n", ret);
    printf("zzz\n");
}

int main()
{
    printf("xxx\n");
    testcase();
    testcase2();
    return 0;
}
