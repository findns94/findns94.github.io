//
// Created by FindNS on 2022/4/4.
//

#include "dp_common.h"

// 输入一个整型数组，数组中的一个或连续多个整数组成一个子数组。求所有子数组的和的最大值。
// 要求时间复杂度为O(n)。
// https://leetcode-cn.com/problems/maximum-subarray/solution/dong-tai-gui-hua-fen-zhi-fa-python-dai-ma-java-dai/
// https://wizardforcel.gitbooks.io/the-art-of-programming-by-july/content/02.04.html

// 1. 暴力
// O(n^3)
int maxSubArray_brute(vector<int> &nums) {
    int maxSum = nums[0];
    int curSum = 0;
    int n = nums.size();
    for (int i = 0; i < n; ++i) {
        for (int j = i; j < n; ++j) {
            for (int k = i; k < j; ++k) {
                curSum += nums[k];
            }
            maxSum = max(maxSum, curSum);
            curSum = 0; //这里要记得清零，否则的话sum最终存放的是所有子数组的和
        }
    }
    return maxSum;
}

// 2. DP
// 如果编号为 i 的子问题的结果是负数或者 00 ，那么编号为 i + 1 的子问题就可以把编号为 i 的子问题的结果舍弃掉
// 一个数 a 加上负数的结果比 a 更小；
// 一个数 a 加上 0 的结果不会比 a 更大；
// dp[i] 表示以nums[i] [结尾]的[连续]子数组的最大和
// dp[i] = dp[i-1] + nums[i] , if dp[i-1] >  0
//       = nums[i]           , if dp[i-1] <= 0
// dp[i] = max(nums[i], dp[i-1]+nums[i])
// dp[0] = nums[0]
// 把所有的 dp[0]、dp[1]、……、dp[n - 1] 都看一遍，取最大值
int maxSubArray_dp(vector<int> &nums) {
    int n = nums.size();
    int maxSum = nums[0];
    vector<int> dp(n, INT_MIN);
    dp[0] = nums[0];
    for (int i = 1; i < n; ++i) {
        dp[i] = max(nums[i], dp[i-1] + nums[i]);
        maxSum = max(maxSum, dp[i]);
    }
    return maxSum;
}

// 2. DP空间优化
// 对第j+1个元素有两种选择：要么放入前面找到的子数组，要么做为新子数组的第一个元素；
// 如果currSum加上当前元素a[j]后不小于a[j]，则令currSum加上a[j]，否则currSum重新赋值，置为下一个元素，即currSum = a[j]。
// 同时，当currSum > maxSum，则更新maxSum = currSum，否则保持原值，不更新。
int maxSubArray(vector<int> &nums) {
    int maxSum = nums[0];
    int curSum = 0;
    int n = nums.size();
    for (int i = 0; i < n; ++i) {
        curSum = max(nums[i], curSum + nums[i]);
        maxSum = max(maxSum, curSum);
    }
    return maxSum;
}

// 3.分治法
// 时间复杂度O(NlogN)
// 空间复杂度O(logN)

void testcase()
{
    vector<int> nums = {-2,1,-3,4,-1,2,1,-5,4};
//    int ret = maxSubArray_brute(nums);
//    int ret = maxSubArray(nums);
    int ret = maxSubArray_dp(nums);
    printf("%d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}

