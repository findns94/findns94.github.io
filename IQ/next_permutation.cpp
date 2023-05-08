//
// Created by FindNS on 2022/4/2.
//

#include "iq_common.h"

// https://leetcode-cn.com/problems/next-permutation/
// https://leetcode-cn.com/problems/next-permutation/solution/xia-yi-ge-pai-lie-suan-fa-xiang-jie-si-lu-tui-dao-/

// 1.交换
// 2.下一个数增加幅度小
//   2.1 尽可能靠右的低位交换,从后向前
//   2.2 尽可能小的[大数]和[小数]交换
//   2.3 [大数]换到前面后,将[大数]后的所有数置为升序
// **折线图**

void nextPermutation(vector<int>& nums) {
    if (nums.size() <= 1) {
        return;
    }
    int i = nums.size() - 2;
    int j = nums.size() - 1;
    int k = nums.size() - 1;
    // find A[i] < A[j]
    while (i >= 0 && nums[i] >= nums[j]) {
        i--;
        j--;
    }
    if (i >= 0) {
        // find A[i] < A[k]
        while (nums[i] >= nums[k]) {
            k--;
        }
        swap(nums[i], nums[k]);
    }
    reverse(nums.begin() + j, nums.end());
}

void testcase1()
{
    vector<int> nums = {4,5,2,6,3,1};
    nextPermutation(nums);
    for (auto c : nums) {
        printf("%d ", c);
    }
    printf("\n");
}

void testcase2()
{
    vector<int> nums = {1,2,3,8,5,7,6,4};
    nextPermutation(nums);
    for (auto c : nums) {
        printf("%d ", c);
    }
    printf("\n");
}

int main()
{
    printf("xxx\n");
    testcase1();
    printf("yyy\n");
    testcase2();
    return 0;
}
