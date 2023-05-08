//
// Created by FindNS on 2022/4/10.
//

#include "dual_common.h"

vector<vector<int>> threeSum(vector<int>& nums) {
    vector<vector<int>> ans;
    sort(nums.begin(), nums.end());
    int n = nums.size();
    for (int i = 0; i < n; ++i) {
        int target = -nums[i];
        int left = i + 1;
        int right = n - 1;
        // 双指针
        while (left < right) {
            int sum = nums[left] + nums[right];
            if (sum < target) {
                left++;
            } else if (sum > target) {
                right--;
            } else {
                // sum == target
                vector<int> triplet = {nums[i], nums[left], nums[right]};
                ans.push_back(triplet);
                while (left < right && nums[left] == triplet[1]) {
                    left++;
                }
                while (left < right && nums[right] == triplet[2]) {
                    right--;
                }
            }
        }
        while (i + 1 < n && nums[i] == nums[i+1]) {
            i++;
        }
    }
    return ans;
}

void testcase()
{
    vector<int> nums_1 = {-1,0,1,2,-1,-4};
    int target = 6;

    printf("yyy\n");
    vector<vector<int>> ret = threeSum(nums_1);
    printf("===\n");
    for (auto n : ret) {
        for (auto m : n) {
            printf("%d \n", m);
        }
        printf("\n");
    }
    printf("zzz\n");
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}
