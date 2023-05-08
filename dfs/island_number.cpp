//
// Created by FindNS on 2022/3/28.
//

#include "dfs_common.h"

// 岛屿数量
// https://leetcode-cn.com/problems/number-of-islands/
// 岛屿面积
// https://leetcode-cn.com/problems/max-area-of-island/
// 填海造陆
// https://leetcode-cn.com/problems/making-a-large-island/
// 岛屿周长
// https://leetcode-cn.com/problems/island-perimeter/

void dfs(vector<vector<char>> &grid, int i, int j, int m, int n) {
    if (i < 0 || i >= m || j < 0 || j >= n) {
        return;
    }
    if (grid[i][j] == '0' || grid[i][j] == '2') {
        return;
    }
    grid[i][j] = '2';
    dfs(grid, i + 1, j, m, n);
    dfs(grid, i - 1, j, m, n);
    dfs(grid, i, j + 1, m, n);
    dfs(grid, i, j - 1, m, n);
}

int numIslands(vector<vector<char>> &grid) {
    int ans = 0;
    int m = grid.size();
    int n = grid[0].size();
    for (int i = 0; i < m; ++i) {
        for (int j = 0; j < n; ++j) {
            if (grid[i][j] == '1') {
                dfs(grid, i, j, m, n);
                ans++;
            }
        }
    }
    return ans;
}

void testcase1()
{
    vector<vector<char>> nums = {
        {'1','1','1','1','0'},
        {'1','1','0','1','0'},
        {'1','1','0','0','0'},
        {'0','0','0','0','0'}
    };
    int ret = numIslands(nums);
    printf("ret = %d\n", ret);
}

void testcase2()
{
    vector<vector<char>> nums = {
        {'1','1','0','0','0'},
        {'1','1','0','0','0'},
        {'0','0','1','0','0'},
        {'0','0','0','1','1'},
    };
    int ret = numIslands(nums);
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
