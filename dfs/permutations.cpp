//
// Created by FindNS on 2022/3/31.
//


#include "dfs_common.h"

// https://leetcode-cn.com/problems/permutations/

// 1.递归
void dfs(vector<int> &nums, int level, vector<vector<int>> &ans)
{
    if (level == nums.size() - 1) {
        ans.push_back(nums);
        return;
    }
    for (int i = level; i < nums.size(); ++i) {
        swap(nums[i], nums[level]);
        dfs(nums, level + 1, ans);
        swap(nums[i], nums[level]);
    }
}

vector<vector<int>> permute(vector<int> &nums)
{
    vector<vector<int>> ans;
    dfs(nums, 0, ans);
    return ans;
}

// 2.非递归todo
// 利用求解字典序下一个排列
// 从最小值不停求解下一个字典序数字
void testcase1()
{
    vector<int> nums = {1, 2, 3};
    vector<vector<int>> ans = permute(nums);
    for (auto m : ans) {
        for (auto n : m) {
            printf("%d ", n);
        }
        printf("\n");
    }
}

//void testcase2()
//{
//    vector<vector<char>> nums = {
//            {'1','1','0','0','0'},
//            {'1','1','0','0','0'},
//            {'0','0','1','0','0'},
//            {'0','0','0','1','1'},
//    };
//    int ret = numIslands(nums);
//    printf("ret = %d\n", ret);
//}

int main()
{
    printf("xxx\n");
    testcase1();
//    printf("yyy\n");
//    testcase2();
    return 0;
}
