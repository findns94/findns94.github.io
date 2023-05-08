//
// Created by FindNS on 2022/3/12.
//

#include "dual_common.h"

vector<int> twoSum(vector<int>& nums, int target) {
    unordered_map<int, int> hashtable;
    for (int i = 0; i < nums.size(); ++i) {
        auto it = hashtable.find(target - nums[i]);
        if (it != hashtable.end()) {
            return {it->second, i};
        }
        hashtable[nums[i]] = i;
    }
    return {};
}

// 注意:需要排除自己的情况
/*
vector<int> twoSum(vector<int>& nums, int target) {
    unordered_map<int, int> m;
    vector<int> ans;
    for (int i = 0; i < nums.size(); ++i) {
        m[nums[i]] = i;
    }
    for (int i = 0; i < nums.size(); ++i) {
        int diff = target - nums[i];
        if (m.count(diff) && m[diff] != i) { // 注意:需要排除自己的情况
            ans.push_back(i);
            ans.push_back(m[diff]);
            return ans;
        }
    }
    return ans;
}
*/

void testcase()
{
    vector<int> nums_1 = {3,2,4};
    int target = 6;

    printf("yyy\n");
    vector<int> ret = twoSum(nums_1, target);
    printf("===\n");
    for (auto n : ret) {
        printf("%d\n", n);
    }
    printf("zzz\n");
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}
