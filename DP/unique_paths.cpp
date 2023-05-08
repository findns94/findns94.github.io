//
// Created by FindNS on 2022/5/2.
//

#include "dp_common.h"

// 从(0,0)走到(m-1,n-1),共有多少种走法
// 移动方向:向右/向下
// 思路:DP
// dp[i][j]表示从(0,0)到达(i,j)的走法数量
// dp[i][j] = dp[i-1][j] + dp[i][j-1]
// 初始化:dp[0][...] = 1, dp[...][0] = 1

int uniquePaths(int m, int n) {
    vector<vector<int>> dp(m, vector<int>(n, 1));
    for (int i = 1; i < m; ++i) {
        for (int j = 1; j < n; ++j) {
            dp[i][j] = dp[i - 1][j] + dp[i][j - 1];
        }
    }
    return dp[m-1][n-1];
}

void testcase()
{
    int ret = uniquePaths(3, 7);
    printf("%d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}

